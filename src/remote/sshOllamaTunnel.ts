import { readFile } from 'node:fs/promises';
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
  return Boolean(expected) && expected === actual;
}

export class SshOllamaTunnel {
  private readonly client: Client;
  private server?: net.Server;
  private localPort?: number;
  private closed = false;

  private constructor(private readonly profile: RemoteGpuProfile, client?: Client) {
    this.client = client ?? new Client();
    this.client.on('error', () => {
      if (!this.closed) void this.close();
    });
  }

  static async open(profile: RemoteGpuProfile, options: TunnelOptions): Promise<SshOllamaTunnel> {
    validateProfile(profile);
    const tunnel = new SshOllamaTunnel(profile, options.client);
    await tunnel.connect(options);
    return tunnel;
  }

  get port(): number {
    if (!this.localPort) throw new Error('SSH tunnel is not connected.');
    return this.localPort;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.client.end();
    if (this.server?.listening) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
  }

  async getGpuStatus(): Promise<string> {
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
      const timeout = setTimeout(() => finish(new Error('SSH connection timed out. Check the host, port, and network.')), 15000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.client.removeListener('ready', onReady);
        this.client.removeListener('error', onError);
        if (error) {
          this.client.end();
          reject(error);
        }
      };
      const onError = (error: Error) => finish(new Error(`SSH connection failed: ${error.message}`));
      const onReady = () => {
        this.server = net.createServer((socket) => {
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
              pipeForwardedSocket(socket, channel);
            }
          );
        });
        this.server.once('error', (error) => finish(new Error(`Could not start the local SSH tunnel: ${error.message}`)));
        this.server.listen(0, '127.0.0.1', () => {
          const address = this.server?.address() as AddressInfo | null;
          if (!address) {
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
      this.client.connect({
        host: this.profile.host,
        port: this.profile.port,
        username: this.profile.username,
        readyTimeout: 12000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostHash: 'sha256',
        hostVerifier: (fingerprint: string, verify: (valid: boolean) => void) => {
          if (fingerprintMatches(this.profile.hostFingerprint, fingerprint)) return true;
          if (this.profile.hostFingerprint) return false;
          void options.verifyUnknownHost(fingerprint).then(verify, () => verify(false));
          return false;
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
