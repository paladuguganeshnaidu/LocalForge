import * as child_process from 'child_process';
import * as crypto from 'crypto';
import * as os from 'os';
import { ScreenObservation, WindowInfo } from './types';

export interface DesktopAdapter {
  captureScreen(): Promise<ScreenObservation>;
  listWindows(): Promise<WindowInfo[]>;
  focusWindow(windowId: string): Promise<boolean>;
  moveMouse(x: number, y: number): Promise<void>;
  clickMouse(x: number, y: number, button?: 'left' | 'right' | 'middle'): Promise<void>;
  typeKeyboard(text: string): Promise<void>;
  sendShortcut(keys: string[]): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
}

export class MockDesktopAdapter implements DesktopAdapter {
  private clipboard = '';
  private currentWindows: WindowInfo[] = [
    {
      id: 'win-1',
      title: 'Visual Studio Code - TuxNest',
      processName: 'Code.exe',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      isFocused: true,
      isPrivileged: false
    },
    {
      id: 'win-2',
      title: 'Terminal - PowerShell',
      processName: 'pwsh.exe',
      bounds: { x: 100, y: 100, width: 1000, height: 700 },
      isFocused: false,
      isPrivileged: false
    }
  ];
  private screenHash = crypto.createHash('sha256').update('initial_mock_screen').digest('hex');

  public async captureScreen(): Promise<ScreenObservation> {
    const active = this.currentWindows.find((w) => w.isFocused) ?? this.currentWindows[0];
    return {
      timestamp: Date.now(),
      width: 1920,
      height: 1080,
      activeWindow: active,
      windows: [...this.currentWindows],
      screenHash: this.screenHash,
      imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    };
  }

  public async listWindows(): Promise<WindowInfo[]> {
    return [...this.currentWindows];
  }

  public async focusWindow(windowId: string): Promise<boolean> {
    let found = false;
    for (const w of this.currentWindows) {
      if (w.id === windowId || w.title.includes(windowId)) {
        w.isFocused = true;
        found = true;
      } else {
        w.isFocused = false;
      }
    }
    this.mutateScreenHash();
    return found;
  }

  public async moveMouse(_x: number, _y: number): Promise<void> {}

  public async clickMouse(_x: number, _y: number, _button?: 'left' | 'right' | 'middle'): Promise<void> {
    this.mutateScreenHash();
  }

  public async typeKeyboard(_text: string): Promise<void> {
    this.mutateScreenHash();
  }

  public async sendShortcut(_keys: string[]): Promise<void> {
    this.mutateScreenHash();
  }

  public async readClipboard(): Promise<string> {
    return this.clipboard;
  }

  public async writeClipboard(text: string): Promise<void> {
    this.clipboard = text;
  }

  public addMockWindow(win: WindowInfo): void {
    this.currentWindows.push(win);
  }

  private mutateScreenHash(): void {
    this.screenHash = crypto.createHash('sha256').update(`screen_${Date.now()}_${Math.random()}`).digest('hex');
  }
}

export class WindowsDesktopAdapter implements DesktopAdapter {
  private fallback = new MockDesktopAdapter();

  public async captureScreen(): Promise<ScreenObservation> {
    return this.fallback.captureScreen();
  }

  public async listWindows(): Promise<WindowInfo[]> {
    return new Promise((resolve) => {
      const psCommand = 'Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json';
      child_process.execFile('powershell', ['-NoProfile', '-Command', psCommand], { windowsHide: true }, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(this.fallback.listWindows());
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          const windows: WindowInfo[] = list.map((item: any) => ({
            id: String(item.Id),
            title: String(item.MainWindowTitle ?? ''),
            processName: String(item.ProcessName ?? ''),
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            isFocused: false
          }));
          resolve(windows);
        } catch {
          resolve(this.fallback.listWindows());
        }
      });
    });
  }

  public async focusWindow(windowId: string): Promise<boolean> {
    return this.fallback.focusWindow(windowId);
  }

  public async moveMouse(x: number, y: number): Promise<void> {
    return this.fallback.moveMouse(x, y);
  }

  public async clickMouse(x: number, y: number, button?: 'left' | 'right' | 'middle'): Promise<void> {
    return this.fallback.clickMouse(x, y, button);
  }

  public async typeKeyboard(text: string): Promise<void> {
    return this.fallback.typeKeyboard(text);
  }

  public async sendShortcut(keys: string[]): Promise<void> {
    return this.fallback.sendShortcut(keys);
  }

  public async readClipboard(): Promise<string> {
    return this.fallback.readClipboard();
  }

  public async writeClipboard(text: string): Promise<void> {
    return this.fallback.writeClipboard(text);
  }
}

export class MacDesktopAdapter implements DesktopAdapter {
  private fallback = new MockDesktopAdapter();

  public captureScreen(): Promise<ScreenObservation> {
    return this.fallback.captureScreen();
  }
  public listWindows(): Promise<WindowInfo[]> {
    return this.fallback.listWindows();
  }
  public focusWindow(id: string): Promise<boolean> {
    return this.fallback.focusWindow(id);
  }
  public moveMouse(x: number, y: number): Promise<void> {
    return this.fallback.moveMouse(x, y);
  }
  public clickMouse(x: number, y: number, button?: 'left' | 'right' | 'middle'): Promise<void> {
    return this.fallback.clickMouse(x, y, button);
  }
  public typeKeyboard(text: string): Promise<void> {
    return this.fallback.typeKeyboard(text);
  }
  public sendShortcut(keys: string[]): Promise<void> {
    return this.fallback.sendShortcut(keys);
  }
  public readClipboard(): Promise<string> {
    return this.fallback.readClipboard();
  }
  public writeClipboard(text: string): Promise<void> {
    return this.fallback.writeClipboard(text);
  }
}

export class LinuxDesktopAdapter implements DesktopAdapter {
  private fallback = new MockDesktopAdapter();

  public captureScreen(): Promise<ScreenObservation> {
    return this.fallback.captureScreen();
  }
  public listWindows(): Promise<WindowInfo[]> {
    return this.fallback.listWindows();
  }
  public focusWindow(id: string): Promise<boolean> {
    return this.fallback.focusWindow(id);
  }
  public moveMouse(x: number, y: number): Promise<void> {
    return this.fallback.moveMouse(x, y);
  }
  public clickMouse(x: number, y: number, button?: 'left' | 'right' | 'middle'): Promise<void> {
    return this.fallback.clickMouse(x, y, button);
  }
  public typeKeyboard(text: string): Promise<void> {
    return this.fallback.typeKeyboard(text);
  }
  public sendShortcut(keys: string[]): Promise<void> {
    return this.fallback.sendShortcut(keys);
  }
  public readClipboard(): Promise<string> {
    return this.fallback.readClipboard();
  }
  public writeClipboard(text: string): Promise<void> {
    return this.fallback.writeClipboard(text);
  }
}

export function createDefaultDesktopAdapter(): DesktopAdapter {
  if (process.platform === 'win32') return new WindowsDesktopAdapter();
  if (process.platform === 'darwin') return new MacDesktopAdapter();
  if (process.platform === 'linux') return new LinuxDesktopAdapter();
  return new MockDesktopAdapter();
}
