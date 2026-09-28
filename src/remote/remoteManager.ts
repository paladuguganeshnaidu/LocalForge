import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { RemoteGpuProfile, SshOllamaTunnel, readPrivateKey } from './sshOllamaTunnel';
import { GpuStatusInfo, parseNvidiaSmiOutput } from './gpuMonitor';
import { OllamaProvider } from '../providers/ollamaProvider';
import { CompositeProvider } from '../providers/compositeProvider';
import { ModelRegistry } from '../providers/modelRegistry';

export const REMOTE_PROFILES_KEY = 'localforge.remoteGpuProfiles';

export interface RemoteSessionInfo {
  profile: RemoteGpuProfile;
  tunnel: SshOllamaTunnel;
  providerId: string;
  provider: OllamaProvider;
  gpuStatus?: GpuStatusInfo[];
  lastChecked?: number;
}

export class RemoteManager {
  private activeSession?: RemoteSessionInfo;
  private readonly context: vscode.ExtensionContext;
  private readonly compositeProvider: CompositeProvider;
  private modelRegistry?: ModelRegistry;

  constructor(
    context: vscode.ExtensionContext,
    compositeProvider: CompositeProvider,
    modelRegistry?: ModelRegistry
  ) {
    this.context = context;
    this.compositeProvider = compositeProvider;
    this.modelRegistry = modelRegistry;
  }

  public setModelRegistry(registry: ModelRegistry): void {
    this.modelRegistry = registry;
  }

  public getActiveSession(): RemoteSessionInfo | undefined {
    return this.activeSession;
  }

  public getProfiles(): RemoteGpuProfile[] {
    return this.context.globalState.get<RemoteGpuProfile[]>(REMOTE_PROFILES_KEY, []);
  }

  public async saveProfile(profile: RemoteGpuProfile, secret?: string): Promise<void> {
    const profiles = this.getProfiles();
    const updated = [...profiles.filter((p) => p.id !== profile.id), profile];
    await this.context.globalState.update(REMOTE_PROFILES_KEY, updated);

    if (secret !== undefined) {
      await this.context.secrets.store(this.getSecretKey(profile.id), JSON.stringify({ secret }));
    }
  }

  public async deleteProfile(profileId: string): Promise<void> {
    if (this.activeSession?.profile.id === profileId) {
      await this.disconnect();
    }
    const profiles = this.getProfiles().filter((p) => p.id !== profileId);
    await this.context.globalState.update(REMOTE_PROFILES_KEY, profiles);
    await this.context.secrets.delete(this.getSecretKey(profileId));
  }

  public async connect(profileId: string): Promise<RemoteSessionInfo> {
    const profile = this.getProfiles().find((p) => p.id === profileId);
    if (!profile) {
      throw new Error(`Remote profile with ID "${profileId}" not found.`);
    }

    if (this.activeSession) {
      await this.disconnect();
    }

    const storedSecret = await this.context.secrets.get(this.getSecretKey(profile.id));
    const credential = storedSecret ? (JSON.parse(storedSecret) as { secret?: string }) : {};

    const verifyUnknownHost = async (fingerprint: string): Promise<boolean> => {
      const choice = await vscode.window.showWarningMessage(
        `First connection to ${profile.host}. Verify this SSH host fingerprint before trusting:\nSHA-256: ${fingerprint}`,
        { modal: true },
        'Trust and save fingerprint'
      );
      if (choice !== 'Trust and save fingerprint') return false;

      profile.hostFingerprint = fingerprint;
      const latest = this.getProfiles();
      await this.context.globalState.update(
        REMOTE_PROFILES_KEY,
        latest.map((item) => (item.id === profile.id ? profile : item))
      );
      return true;
    };

    const options =
      profile.authenticationMethod === 'password'
        ? { password: credential.secret, verifyUnknownHost }
        : {
            privateKey: await readPrivateKey(profile.privateKeyPath ?? ''),
            passphrase: credential.secret || undefined,
            verifyUnknownHost
          };

    const tunnel = await SshOllamaTunnel.open(profile, options);
    const providerId = `ssh-ollama-${profile.id}`;
    const remoteOllamaProvider = new OllamaProvider(`http://127.0.0.1:${tunnel.port}`, providerId);

    this.compositeProvider.addProvider(remoteOllamaProvider);

    let gpuStatus: GpuStatusInfo[] = [];
    try {
      const rawGpu = await tunnel.getGpuStatus();
      gpuStatus = parseNvidiaSmiOutput(rawGpu);
    } catch {
      // GPU probe may fail if nvidia-smi is not available
    }

    if (this.modelRegistry) {
      const gpuSummary = gpuStatus[0]?.displayText;
      this.modelRegistry.registerProvider(
        remoteOllamaProvider,
        'remote',
        `http://127.0.0.1:${tunnel.port}`,
        gpuSummary
      );
      await this.modelRegistry.refresh();
    }

    this.activeSession = {
      profile,
      tunnel,
      providerId,
      provider: remoteOllamaProvider,
      gpuStatus,
      lastChecked: Date.now()
    };

    return this.activeSession;
  }

  public async refreshGpuStatus(): Promise<GpuStatusInfo[]> {
    if (!this.activeSession) return [];
    try {
      const raw = await this.activeSession.tunnel.getGpuStatus();
      const status = parseNvidiaSmiOutput(raw);
      this.activeSession.gpuStatus = status;
      this.activeSession.lastChecked = Date.now();
      return status;
    } catch (error) {
      return [];
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.activeSession) return;
    try {
      this.compositeProvider.removeProvider(this.activeSession.providerId);
      if (this.modelRegistry) {
        this.modelRegistry.unregisterProvider(this.activeSession.providerId);
        await this.modelRegistry.refresh();
      }
      await this.activeSession.tunnel.close();
    } finally {
      this.activeSession = undefined;
    }
  }

  private getSecretKey(profileId: string): string {
    return `localforge.remote.${profileId}.credential`;
  }
}
