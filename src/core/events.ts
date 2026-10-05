import { EventEmitter } from 'node:events';
import { WorkspaceIndexStatus } from '../context/workspaceIndexer';

export interface LocalForgeEvents {
  'modelChanged': (modelId: string) => void;
  'sessionUpdated': (sessionId: string) => void;
  'remoteConnected': (profileName: string) => void;
  'remoteDisconnected': (reason?: Error) => void;
  'gpuStatusUpdated': (gpuText: string) => void;
  'indexProgress': (status: string) => void;
  'indexStatus': (status: WorkspaceIndexStatus) => void;
}

export class LocalForgeEventEmitter extends EventEmitter {
  public override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}
