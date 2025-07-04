/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import { appendFile, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import * as readline from 'readline';
import type { ListEvalKeysRequest, ListEvalKeysResponse } from '../types/apis';
import {
  EvalRunKeySchema,
  EvalRunSchema,
  type EvalRun,
  type EvalRunKey,
  type EvalStore,
} from '../types/eval';
import { logger } from '../utils/logger';

/**
 * A local, file-based EvalStore implementation.
 */
export class LocalFileEvalStore implements EvalStore {
  private readonly storeRoot;
  private readonly indexFile;
  private readonly INDEX_DELIMITER = '\n';
  private static cachedEvalStore: LocalFileEvalStore | null = null;

  private constructor() {
    this.storeRoot = this.generateRootPath();
    this.indexFile = this.getIndexFilePath();
    fs.mkdirSync(this.storeRoot, { recursive: true });
    if (!fs.existsSync(this.indexFile)) {
      fs.writeFileSync(path.resolve(this.indexFile), '');
    }
    logger.debug(
      `Initialized local file eval store at root: ${this.storeRoot}`
    );
  }

  static getEvalStore() {
    if (!this.cachedEvalStore) {
      this.cachedEvalStore = new LocalFileEvalStore();
    }
    return this.cachedEvalStore;
  }

  static reset() {
    this.cachedEvalStore = null;
  }

  async save(evalRun: EvalRun): Promise<void> {
    const fileName = this.generateFileName(evalRun.key.evalRunId);

    logger.debug(
      `Saving EvalRun ${evalRun.key.evalRunId} to ` +
        path.resolve(this.storeRoot, fileName)
    );
    await writeFile(
      path.resolve(this.storeRoot, fileName),
      JSON.stringify(evalRun)
    );

    logger.debug(
      `Save EvalRunKey ${JSON.stringify(evalRun.key)} to ` +
        path.resolve(this.indexFile)
    );
    await appendFile(
      path.resolve(this.indexFile),
      JSON.stringify(evalRun.key) + this.INDEX_DELIMITER
    );
  }

  async load(evalRunId: string): Promise<EvalRun | undefined> {
    const filePath = path.resolve(
      this.storeRoot,
      this.generateFileName(evalRunId)
    );
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    return await readFile(filePath, 'utf8').then((data) =>
      EvalRunSchema.parse(JSON.parse(data))
    );
  }

  async list(
    query?: ListEvalKeysRequest | undefined
  ): Promise<ListEvalKeysResponse> {
    let keys = await readFile(this.indexFile, 'utf8').then((data) => {
      if (!data) {
        return [];
      }
      // strip the final carriage return before parsing all lines
      return data
        .slice(0, -1)
        .split(this.INDEX_DELIMITER)
        .map(this.parseLineToKey);
    });

    logger.debug(`Found keys: ${JSON.stringify(keys)}`);

    if (query?.filter?.actionRef) {
      keys = keys.filter((key) => key.actionRef === query?.filter?.actionRef);
      logger.debug(`Filtered keys: ${JSON.stringify(keys)}`);
    }

    return {
      evalRunKeys: keys,
    };
  }

  async delete(evalRunId: string): Promise<void> {
    const filePath = path.resolve(
      this.storeRoot,
      this.generateFileName(evalRunId)
    );
    if (!fs.existsSync(filePath)) {
      throw new Error(`Cannot find evalRun with id '${evalRunId}'`);
    }
    return await unlink(filePath).then(() =>
      this.deleteEvalRunFromIndex(evalRunId)
    );
  }

  private generateFileName(evalRunId: string): string {
    return `${evalRunId}.json`;
  }

  private getIndexFilePath(): string {
    return path.resolve(this.storeRoot, 'index.txt');
  }

  private parseLineToKey(key: string): EvalRunKey {
    return EvalRunKeySchema.parse(JSON.parse(key));
  }

  private generateRootPath(): string {
    return path.resolve(process.cwd(), `.genkit/evals`);
  }

  private async deleteEvalRunFromIndex(evalRunId: string): Promise<void> {
    const entries = [];
    const fileStream = fs.createReadStream(this.getIndexFilePath());
    const rl = readline.createInterface({
      input: fileStream,
    });

    for await (const line of rl) {
      const entry = EvalRunKeySchema.parse(JSON.parse(line));
      if (entry.evalRunId !== evalRunId) {
        entries.push(line);
      }
    }

    await writeFile(
      this.getIndexFilePath(),
      // end with delimiter to parse correctly
      entries.join(this.INDEX_DELIMITER) + this.INDEX_DELIMITER
    );
  }
}
