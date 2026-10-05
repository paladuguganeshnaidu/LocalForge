import * as vscode from 'vscode';
import { RemoteGpuProfile, SshOllamaTunnel, readPrivateKey } from './sshOllamaTunnel';
import { GpuStatusInfo, parseNvidiaSmiOutput } from './gpuMonitor';
import { OllamaGenerationOptions, OllamaProvider } from '../providers/ollamaProvider';
import { CompositeProvider } from '../providers/compositeProvider';
import { ModelRegistry } from '../providers/modelRegistry';

export const REMOTE_PROFILES_KEY = 'tuxnest.remoteGpuProfiles';

export interface RemoteSessionInfo {
  profile: RemoteGpuProfile;
  tunnel: SshOllamaTunnel;
  providerId: string;
  provider: OllamaProvider;
  gpuStatus?: GpuStatusInfo[];
  lastChecked?: number;
  closeSubscription?: { dispose(): void };
}

export class RemoteManager {
  private activeSession?: RemoteSessionInfo;
  private readonly context: vscode.ExtensionContext;
  private readonly compositeProvider: CompositeProvider;
  private modelRegistry?: ModelRegistry;
  private connectionRevision = 0;

  constructor(
    context: vscode.ExtensionContext,
    compositeProvider: CompositeProvider,
    modelRegistry?: ModelRegistry,
    private readonly generationOptions?: () => OllamaGenerationOptions,
    private readonly onDisconnected?: (reason?: Error) => void
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

    const revision = ++this.connectionRevision;
    await this.releaseActiveSession();

    const storedSecret = await this.context.secrets.get(this.getSecretKey(profile.id));
    const credential = storedSecret ? (JSON.parse(storedSecret) as { secret?: string }) : {};

    const verifyUnknownHost = async (fingerprint: string): Promise<boolean> => {
      const choice = await vscode.window.showWarningMessage(
        `First connection to ${profile.host}. Verify this SSH host fingerprint before trusting:\n${fingerprint}`,
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
    if (revision !== this.connectionRevision) {
      await tunnel.close();
      throw new Error('This SSH connection was superseded or cancelled.');
    }
    const providerId = `ssh-ollama-${profile.id}`;
    const remoteOllamaProvider = new OllamaProvider(`http://127.0.0.1:${tunnel.port}`, providerId, this.generationOptions);
    const session: RemoteSessionInfo = { profile, tunnel, providerId, provider: remoteOllamaProvider };
    this.activeSession = session;
    session.closeSubscription = tunnel.onDidClose((reason) => {
      if (this.activeSession !== session) return;
      this.activeSession = undefined;
      this.removeSessionProvider(session);
      this.onDisconnected?.(reason);
    });
    this.compositeProvider.addProvider(remoteOllamaProvider);

    try {
      let gpuStatus: GpuStatusInfo[] = [];
      try {
        const rawGpu = await tunnel.getGpuStatus();
        gpuStatus = parseNvidiaSmiOutput(rawGpu);
      } catch {}

      if (this.activeSession !== session || revision !== this.connectionRevision || !tunnel.isConnected) {
        throw new Error('The SSH connection closed or was cancelled during setup. Verify that the remote studio is running, then reconnect.');
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

      if (this.activeSession !== session || revision !== this.connectionRevision || !tunnel.isConnected) {
        throw new Error('The SSH connection closed or was cancelled during model discovery. Reconnect before selecting a remote model.');
      }
      session.gpuStatus = gpuStatus;
      session.lastChecked = Date.now();
      return session;
    } catch (error) {
      if (this.activeSession === session) this.activeSession = undefined;
      session.closeSubscription?.dispose();
      this.removeSessionProvider(session);
      await tunnel.close();
      throw error;
    }
  }

  public async refreshGpuStatus(): Promise<GpuStatusInfo[]> {
    const session = this.activeSession;
    if (!session) return [];
    try {
      const raw = await session.tunnel.getGpuStatus();
      if (this.activeSession !== session) return [];
      const status = parseNvidiaSmiOutput(raw);
      session.gpuStatus = status;
      session.lastChecked = Date.now();
      return status;
    } catch (error) {
      return [];
    }
  }

  public async disconnect(): Promise<void> {
    this.connectionRevision += 1;
    await this.releaseActiveSession();
  }

  private removeSessionProvider(session: RemoteSessionInfo): void {
    if (this.compositeProvider.getProviders().includes(session.provider)) this.compositeProvider.removeProvider(session.providerId);
    if (this.modelRegistry?.getProvider(session.providerId) === session.provider) this.modelRegistry.unregisterProvider(session.providerId);
    session.provider.dispose();
  }

  private async releaseActiveSession(): Promise<void> {
    const session = this.activeSession;
    if (!session) return;
    this.activeSession = undefined;
    session.closeSubscription?.dispose();
    this.removeSessionProvider(session);
    this.onDisconnected?.();
    await session.tunnel.close();
  }

  private getSecretKey(profileId: string): string {
    return `tuxnest.remote.${profileId}.credential`;
  }
}
