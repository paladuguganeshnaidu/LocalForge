import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type * as vscode from 'vscode';
import { validateWorkspaceRelativePath } from '../core/workspacePaths';

export const EDIT_JOURNAL_KEY = 'localforge.editRecovery.v1';
const maximumRecords = 40;
const maximumBytes = 16 * 1024 * 1024;

export type RecoveryStatus = 'prepared' | 'applied' | 'failed' | 'partially_reverted' | 'reverted';

export interface RecoveryFile {
  path: string;
  originalState: 'present' | 'missing';
  originalBytes: string;
  originalHash: string;
  expectedHash: string;
  reverted: boolean;
  linkedPath?: string;
}

export interface RecoveryRecord {
  id: string;
  proposalId: string;
  root: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
  status: RecoveryStatus;
  files: RecoveryFile[];
}

export interface RecoverySummary {
  id: string;
  proposalId: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
  status: RecoveryStatus;
  files: string[];
  remainingFiles: string[];
}

function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function replaceJournalFile(source: string, destination: string, replace: (source: string, destination: string) => Promise<void> = rename): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await replace(source, destination); return; }
    catch (error) {
      if (attempt >= 6 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}

function isRecord(value: unknown): value is RecoveryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as RecoveryRecord;
  if (typeof record.id !== 'string' || !/^undo-[a-f0-9-]{36}$/.test(record.id) ||
      typeof record.proposalId !== 'string' || record.proposalId.length > 200 ||
      typeof record.root !== 'string' || record.root.length > 4096 || !/^[a-z][a-z0-9+.-]*:/i.test(record.root) ||
      typeof record.summary !== 'string' || record.summary.length > 2000 ||
      !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt) ||
      !['prepared', 'applied', 'failed', 'partially_reverted', 'reverted'].includes(record.status) ||
      !Array.isArray(record.files) || !record.files.length || record.files.length > 1000) return false;
  const paths = new Set<string>();
  let bytesTotal = 0;
  for (const file of record.files) {
    if (!file || typeof file.path !== 'string' || file.path.length > 1024 ||
        !['present', 'missing'].includes(file.originalState) || typeof file.originalBytes !== 'string' ||
        typeof file.reverted !== 'boolean' || typeof file.expectedHash !== 'string' || (file.expectedHash !== '' && !/^[a-f0-9]{64}$/.test(file.expectedHash)) ||
        typeof file.originalHash !== 'string' || file.originalBytes.length > maximumBytes) return false;
    try { validateWorkspaceRelativePath(file.path); } catch { return false; }
    bytesTotal += file.originalBytes.length + file.path.length;
    if (bytesTotal > maximumBytes) return false;
    const relativePath = file.path.replace(/\\/g, '/');
    const normalized = process.platform === 'win32' && record.root.toLowerCase().startsWith('file:') ? relativePath.toLowerCase() : relativePath;
    if (paths.has(normalized)) return false;
    paths.add(normalized);
    const bytes = Buffer.from(file.originalBytes, 'base64');
    if (bytes.toString('base64') !== file.originalBytes) return false;
    if (file.originalState === 'missing' ? file.originalBytes !== '' || file.originalHash !== '' : contentHash(bytes) !== file.originalHash) return false;
    if (file.originalState === 'missing' && file.expectedHash === '') return false;
    if (file.linkedPath !== undefined) {
      const linked = record.files.find((candidate) => candidate?.path === file.linkedPath);
      if (typeof file.linkedPath !== 'string' || file.linkedPath === file.path || !linked || linked.linkedPath !== file.path) return false;
      if (file.originalState === 'present' ? file.expectedHash !== '' || linked.originalState !== 'missing' || linked.expectedHash !== file.originalHash
        : linked.originalState !== 'present' || linked.expectedHash !== '' || file.expectedHash !== linked.originalHash) return false;
    }
  }
  return true;
}

export class EditJournal {
  private records: RecoveryRecord[] = [];
  private queue: Promise<void> = Promise.resolve();
  private persistenceError?: Error;

  constructor(private readonly storage?: vscode.Memento, private readonly directory?: string) {
    let saved = storage?.get<unknown>(EDIT_JOURNAL_KEY);
    let durable = false;
    if (directory) {
      try {
        const target = join(directory, 'edit-recovery.v1.json');
        if (statSync(target).size > maximumBytes + 128) throw new Error('Recovery storage exceeds its size limit.');
        saved = JSON.parse(readFileSync(target, 'utf8'));
        durable = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.persistenceError = new Error(`Cannot read edit recovery storage: ${error instanceof Error ? error.message : String(error)}. Existing backups were not changed.`);
          return;
        }
      }
    }
    if (!saved || typeof saved !== 'object') {
      if (durable) this.persistenceError = new Error('Invalid edit recovery storage. Existing backups were not changed.');
      return;
    }
    const data = saved as { version?: unknown; records?: unknown };
    if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > maximumRecords) {
      if (durable) this.persistenceError = new Error('Invalid edit recovery storage. Existing backups were not changed.');
      return;
    }
    const ids = new Set<string>();
    let size = 0;
    for (const value of data.records) {
      if (!isRecord(value) || ids.has(value.id)) {
        if (durable) {
          this.records = [];
          this.persistenceError = new Error('Invalid edit recovery snapshot. Existing backups were not changed.');
          return;
        }
        continue;
      }
      size += Buffer.byteLength(JSON.stringify(value));
      if (size > maximumBytes) {
        if (durable) {
          this.records = [];
          this.persistenceError = new Error('Edit recovery storage exceeds its size limit. Existing backups were not changed.');
        }
        break;
      }
      ids.add(value.id);
      this.records.push(structuredClone(value));
    }
  }

  public get(id: string): RecoveryRecord | undefined {
    const record = this.records.find((entry) => entry.id === id);
    return record ? structuredClone(record) : undefined;
  }

  public list(): RecoverySummary[] {
    return this.records.slice().reverse().map((record) => ({
      id: record.id,
      proposalId: record.proposalId,
      summary: record.summary,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      status: record.status,
      files: record.files.map((file) => file.path),
      remainingFiles: record.files.filter((file) => !file.reverted).map((file) => file.path)
    }));
  }

  public async prepare(input: Omit<RecoveryRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<RecoveryRecord> {
    const record: RecoveryRecord = {
      ...structuredClone(input), id: `undo-${randomUUID()}`, createdAt: Date.now(), updatedAt: Date.now(), status: 'prepared'
    };
    if (!isRecord(record)) throw new Error('The edit recovery record is invalid. No edits were submitted.');
    await this.mutate((records) => {
      records.push(record);
      while (records.length > maximumRecords || Buffer.byteLength(JSON.stringify(records)) > maximumBytes) {
        const removable = records.findIndex((entry) => entry.id !== record.id && entry.status === 'reverted');
        if (removable < 0) throw new Error('Edit recovery storage is full. Remove older recovery records before applying more edits.');
        records.splice(removable, 1);
      }
    });
    return structuredClone(record);
  }

  public async update(id: string, status: RecoveryStatus, changes: Array<{ path: string; expectedHash?: string; reverted?: boolean }> = []): Promise<void> {
    await this.mutate((records) => {
      const record = records.find((entry) => entry.id === id);
      if (!record) throw new Error('The edit recovery record is unavailable.');
      for (const change of changes) {
        const file = record.files.find((entry) => entry.path === change.path);
        if (!file) throw new Error('The recovery update references an unknown file.');
        if (change.expectedHash !== undefined) file.expectedHash = change.expectedHash;
        if (change.reverted !== undefined) file.reverted = change.reverted;
      }
      record.status = status;
      record.updatedAt = Date.now();
      if (!isRecord(record)) throw new Error('The edit recovery update is invalid.');
    });
  }

  public async forget(id: string): Promise<void> {
    await this.mutate((records) => {
      const index = records.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error('The edit recovery record is unavailable.');
      records.splice(index, 1);
    });
  }

  private async mutate(change: (records: RecoveryRecord[]) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.persistenceError) throw this.persistenceError;
      const records = structuredClone(this.records);
      change(records);
      const payload = { version: 1, records };
      if (Buffer.byteLength(JSON.stringify(payload)) > maximumBytes + 128) throw new Error('Edit recovery storage exceeds its size limit.');
      if (this.directory) {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = join(this.directory, `edit-recovery-${randomUUID()}.tmp`);
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(JSON.stringify(payload), 'utf8');
            await handle.sync();
          } finally { await handle.close(); }
          await replaceJournalFile(temporary, join(this.directory, 'edit-recovery.v1.json'));
        } finally {
          await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
        }
      } else if (this.storage) {
        await this.storage.update(EDIT_JOURNAL_KEY, payload);
      }
      this.records = records;
    });
    this.queue = operation.catch(() => {});
    await operation;
  }
}
