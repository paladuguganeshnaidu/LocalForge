import { EventEmitter } from 'node:events';
import { WorkspaceIndexStatus } from '../context/workspaceIndexer';

export interface TuxNestEvents {
  'modelChanged': (modelId: string) => void;
  'sessionUpdated': (sessionId: string) => void;
  'remoteConnected': (profileName: string) => void;
  'remoteDisconnected': (reason?: Error) => void;
  'gpuStatusUpdated': (gpuText: string) => void;
  'indexProgress': (status: string) => void;
  'indexStatus': (status: WorkspaceIndexStatus) => void;
}

export type LocalForgeEvents = TuxNestEvents;

export class TuxNestEventEmitter extends EventEmitter {
  public override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}

export const LocalForgeEventEmitter = TuxNestEventEmitter;
export type LocalForgeEventEmitter = TuxNestEventEmitter;
