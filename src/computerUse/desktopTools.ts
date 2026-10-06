import { ModelToolDefinition } from '../providers/modelProvider';
import { ToolRegistry } from '../agent/toolRegistry';
import { ComputerUseManager } from './computerUseManager';

export const DESKTOP_OBSERVE_TOOL: ModelToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_observe',
    description: 'Capture screenshot, active window title, and list of open windows for desktop automation. Returns observation with screenHash.',
    parameters: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Run ID or task correlation identifier.' }
      },
      additionalProperties: false
    }
  }
};

export const DESKTOP_CLICK_TOOL: ModelToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_click',
    description: 'Click at specified desktop screen coordinates (x, y) with freshness verification and action receipt.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X pixel coordinate on screen.' },
        y: { type: 'number', description: 'Y pixel coordinate on screen.' },
        expectedScreenHash: { type: 'string', description: 'Freshness hash from prior desktop_observe to prevent blind execution.' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button to click.' }
      },
      required: ['x', 'y'],
      additionalProperties: false
    }
  }
};

export const DESKTOP_TYPE_TOOL: ModelToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_type',
    description: 'Type text into currently focused desktop field with sensitive input detection.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type.' },
        expectedScreenHash: { type: 'string', description: 'Freshness hash from prior desktop_observe.' }
      },
      required: ['text'],
      additionalProperties: false
    }
  }
};

export const DESKTOP_SHORTCUT_TOOL: ModelToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_shortcut',
    description: 'Send keyboard shortcut combo (e.g. ["Control", "c"] or ["Alt", "Tab"]).',
    parameters: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keys in sequence or combination.'
        },
        expectedScreenHash: { type: 'string', description: 'Freshness hash from prior desktop_observe.' }
      },
      required: ['keys'],
      additionalProperties: false
    }
  }
};

export const DESKTOP_FOCUS_WINDOW_TOOL: ModelToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_focus_window',
    description: 'Bring a specific window to the foreground by window ID or partial title.',
    parameters: {
      type: 'object',
      properties: {
        windowIdOrTitle: { type: 'string', description: 'Window ID or title to focus.' }
      },
      required: ['windowIdOrTitle'],
      additionalProperties: false
    }
  }
};

export function registerDesktopTools(registry: ToolRegistry, manager: ComputerUseManager): void {
  registry.registerTool(DESKTOP_OBSERVE_TOOL, async (args) => {
    const runId = typeof args.runId === 'string' ? args.runId : 'default';
    const obs = await manager.observe(runId);
    return {
      width: obs.width,
      height: obs.height,
      activeWindow: obs.activeWindow,
      windows: obs.windows.map((w) => ({ id: w.id, title: w.title, processName: w.processName })),
      screenHash: obs.screenHash,
      imageBase64: obs.imageBase64
    };
  });

  registry.registerTool(DESKTOP_CLICK_TOOL, async (args) => {
    const x = Number(args.x);
    const y = Number(args.y);
    const hash = typeof args.expectedScreenHash === 'string' ? args.expectedScreenHash : undefined;
    const button = args.button === 'right' || args.button === 'middle' ? args.button : 'left';
    const receipt = await manager.click('agent-desktop-run', { x, y }, hash, button);
    return { success: true, receipt };
  });

  registry.registerTool(DESKTOP_TYPE_TOOL, async (args) => {
    const text = String(args.text ?? '');
    const hash = typeof args.expectedScreenHash === 'string' ? args.expectedScreenHash : undefined;
    const receipt = await manager.type('agent-desktop-run', text, hash);
    return { success: true, receipt };
  });

  registry.registerTool(DESKTOP_SHORTCUT_TOOL, async (args) => {
    const keys = Array.isArray(args.keys) ? args.keys.map(String) : [];
    const hash = typeof args.expectedScreenHash === 'string' ? args.expectedScreenHash : undefined;
    const receipt = await manager.sendShortcut('agent-desktop-run', keys, hash);
    return { success: true, receipt };
  });

  registry.registerTool(DESKTOP_FOCUS_WINDOW_TOOL, async (args) => {
    const target = String(args.windowIdOrTitle ?? '');
    const receipt = await manager.focusWindow('agent-desktop-run', target);
    return { success: true, receipt };
  });
}
