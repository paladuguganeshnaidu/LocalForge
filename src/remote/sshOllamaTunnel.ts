import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as net from 'node:net';
import { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { Client, ClientChannel } from 'ssh2';

export type RemoteAuthentication =
  | { method: 'password'; secret: string }
  | { method: 'privateKey'; keyPath: string; passphrase?: string };

export interface RemoteGpuProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  remoteOllamaHost: string;
  remoteOllamaPort: number;
  hostFingerprint?: string;
  authenticationMethod: RemoteAuthentication['method'];
  privateKeyPath?: string;
}

export interface TunnelOptions {
  verifyUnknownHost: (fingerprint: string) => Promise<boolean>;
  password?: string;
  passphrase?: string;
  privateKey?: Buffer;
  client?: Client;
}

export function fingerprintMatches(expected: string | undefined, actual: string): boolean {
  const expectedFingerprint = expected ? normalizeFingerprint(expected) : undefined;
  return Boolean(expectedFingerprint) && expectedFingerprint === normalizeFingerprint(actual);
}

function normalizeFingerprint(fingerprint: string): string | undefined {
  if (/^[a-f\d]{64}$/i.test(fingerprint)) return `SHA256:${Buffer.from(fingerprint, 'hex').toString('base64').replace(/=+$/, '')}`;
  if (/^SHA256:[A-Za-z\d+/]{43}=?$/.test(fingerprint)) return fingerprint.replace(/=+$/, '');
  return undefined;
}

export class SshOllamaTunnel {
  private readonly client: Client;
  private server?: net.Server;
  private localPort?: number;
  private closed = false;
  private closePromise?: Promise<void>;
  private closeReason?: Error;
  private readonly sockets = new Set<net.Socket>();
  private readonly closeListeners = new Set<(reason?: Error) => void>();

  private constructor(private readonly profile: RemoteGpuProfile, client?: Client) {
    this.client = client ?? new Client();
    this.client.on('error', () => { void this.close(new Error('The SSH connection failed. Verify that the remote studio and network are available, then reconnect.')); });
    this.client.on('end', () => { void this.close(new Error('The remote host ended the SSH connection. Verify that the remote studio is running, then reconnect.')); });
    this.client.on('close', () => { void this.close(new Error('The SSH connection closed. Verify that the remote studio and network are available, then reconnect.')); });
  }

  static async open(profile: RemoteGpuProfile, options: TunnelOptions): Promise<SshOllamaTunnel> {
    validateProfile(profile);
    const tunnel = new SshOllamaTunnel(profile, options.client);
    await tunnel.connect(options);
    return tunnel;
  }

  get port(): number {
    if (!this.localPort || this.closed) throw new Error('SSH tunnel is not connected.');
    return this.localPort;
  }

  get isConnected(): boolean {
    return !this.closed && this.localPort !== undefined;
  }

  onDidClose(listener: (reason?: Error) => void): { dispose(): void } {
    this.closeListeners.add(listener);
    if (this.closed) queueMicrotask(() => { if (this.closeListeners.delete(listener)) { try { listener(this.closeReason); } catch {} } });
    return { dispose: () => { this.closeListeners.delete(listener); } };
  }

  close(reason?: Error): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.localPort = undefined;
    this.closeReason = reason;
    this.closePromise = this.server?.listening
      ? new Promise<void>((resolve) => this.server!.close(() => resolve()))
      : Promise.resolve();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.client.end();
    for (const listener of this.closeListeners) {
      try { listener(reason); } catch {}
    }
    this.closeListeners.clear();
    return this.closePromise;
  }

  async getGpuStatus(): Promise<string> {
    if (!this.isConnected) throw new Error('SSH tunnel is not connected.');
    const command = 'nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits';
    return new Promise((resolve, reject) => {
      this.client.exec(command, (error, channel) => {
        if (error) {
          reject(new Error(`Could not run the read-only GPU status probe: ${error.message}`));
          return;
        }
        const result = collectCommandOutput(channel, 5000);
        result.then(resolve, reject);
      });
    });
  }

  private async connect(options: TunnelOptions): Promise<void> {
    const auth: Record<string, unknown> = options.password !== undefined
      ? { password: options.password }
      : { privateKey: options.privateKey, passphrase: options.passphrase };

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const connectionTimeout = this.profile.hostFingerprint ? 15000 : 120000;
      const timeout = setTimeout(() => finish(new Error('SSH connection timed out. Check the host, port, and network.')), connectionTimeout);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.client.removeListener('ready', onReady);
        this.client.removeListener('error', onError);
        this.client.removeListener('close', onClose);
        this.client.removeListener('end', onClose);
        if (error) {
          void this.close(error);
          reject(error);
        }
      };
      const onError = (error: Error) => finish(new Error(`SSH connection failed: ${error.message}`));
      const onClose = () => finish(new Error('SSH connection closed before the local tunnel was ready. Verify that the remote studio is running, then reconnect.'));
      const onReady = () => {
        if (this.closed) { onClose(); return; }
        this.server = net.createServer((socket) => {
          this.sockets.add(socket);
          socket.on('error', () => socket.destroy());
          socket.once('close', () => this.sockets.delete(socket));
          if (this.closed) { socket.destroy(); return; }
          this.client.forwardOut(
            socket.remoteAddress ?? '127.0.0.1',
            socket.remotePort ?? 0,
            this.profile.remoteOllamaHost,
            this.profile.remoteOllamaPort,
            (error, channel) => {
              if (error) {
                socket.destroy(error);
                return;
              }
              if (socket.destroyed) { channel.close(); return; }
              pipeForwardedSocket(socket, channel);
            }
          );
        });
        this.server.on('error', (error) => {
          const failure = new Error(`Could not maintain the local SSH tunnel: ${error.message}`);
          finish(failure);
          void this.close(failure);
        });
        this.server.listen(0, '127.0.0.1', () => {
          const address = this.server?.address() as AddressInfo | null;
          if (!address || this.closed) {
            if (this.server?.listening) this.server.close();
            finish(new Error('The SSH tunnel did not receive a local port.'));
            return;
          }
          this.localPort = address.port;
          finish();
          resolve();
        });
      };

      this.client.once('ready', onReady);
      this.client.once('error', onError);
      this.client.once('close', onClose);
      this.client.once('end', onClose);
      this.client.connect({
        host: this.profile.host,
        port: this.profile.port,
        username: this.profile.username,
        readyTimeout: this.profile.hostFingerprint ? 12000 : 120000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          const fingerprint = createHash('sha256').update(key).digest('hex');
          if (fingerprintMatches(this.profile.hostFingerprint, fingerprint)) { verify(true); return; }
          if (this.profile.hostFingerprint) { verify(false); return; }
          const normalized = normalizeFingerprint(fingerprint);
          if (!normalized) { verify(false); return; }
          void options.verifyUnknownHost(normalized).then(valid => verify(!settled && valid), () => verify(false));
        },
        ...auth
      });
    });
  }
}

function validateProfile(profile: RemoteGpuProfile): void {
  if (!profile.host.trim() || !profile.username.trim()) throw new Error('Remote host and username are required.');
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) throw new Error('SSH port must be between 1 and 65535.');
  if (!Number.isInteger(profile.remoteOllamaPort) || profile.remoteOllamaPort < 1 || profile.remoteOllamaPort > 65535) {
    throw new Error('Remote Ollama port must be between 1 and 65535.');
  }
  if (!/^[a-zA-Z0-9.:-]+$/.test(profile.remoteOllamaHost)) throw new Error('Remote Ollama host must be a hostname or IP address.');
}

function pipeForwardedSocket(socket: net.Socket, channel: ClientChannel): void {
  socket.on('error', () => channel.destroy());
  channel.on('error', () => socket.destroy());
  socket.on('close', () => channel.close());
  channel.on('close', () => socket.destroy());
  socket.pipe(channel).pipe(socket);
}

function collectCommandOutput(channel: ClientChannel, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let exitCode: number | undefined;
    const timeout = setTimeout(() => {
      channel.close();
      reject(new Error('GPU status request timed out.'));
    }, timeoutMs);
    channel.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
    channel.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
    channel.on('exit', (code) => { exitCode = typeof code === 'number' ? code : undefined; });
    channel.on('close', () => {
      clearTimeout(timeout);
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || 'nvidia-smi is unavailable on this remote machine.'));
        return;
      }
      const rows = stdout.trim();
      if (!rows) {
        reject(new Error('The remote GPU probe returned no NVIDIA GPU data.'));
        return;
      }
      resolve(rows);
    });
  });
}

export async function readPrivateKey(keyPath: string): Promise<Buffer> {
  if (!keyPath.trim()) throw new Error('Choose an SSH private key file.');
  const expanded = keyPath.replace(/^~(?=$|[\\/])/, homedir());
  return readFile(expanded);
}
