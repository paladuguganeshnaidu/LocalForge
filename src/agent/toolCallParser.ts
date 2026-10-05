import { ModelToolCall } from '../providers/modelProvider';

export interface ParsedModelTurn {
  userVisibleText: string;
  toolCalls: ModelToolCall[];
  hadToolCallSyntax: boolean;
  parseWarnings: string[];
}

const TOOL_NAME_ALIASES: Record<string, string> = {
  write_file: 'write_workspace_file',
  create_file: 'write_workspace_file',
  new_file: 'write_workspace_file',
  create_workspace_file: 'write_workspace_file',
  'create-node-program': 'write_workspace_file',
  read_file: 'read_workspace_file',
  get_file: 'read_workspace_file',
  view_file: 'read_workspace_file',
  edit_file: 'edit_workspace_file',
  modify_file: 'edit_workspace_file',
  update_file: 'edit_workspace_file',
  patch_file: 'edit_workspace_file',
  run_command: 'run_command',
  execute_command: 'run_command',
  run_terminal_command: 'run_command',
  terminal: 'run_command',
  shell: 'run_command',
  exec: 'run_command',
  search_workspace: 'search_workspace',
  find_in_workspace: 'search_workspace',
  search_code: 'search_workspace',
  list_directory: 'list_directory',
  list_dir: 'list_directory',
  list_files: 'list_directory'
};

export class ToolCallParser {
  /**
   * Parse a model turn, extracting any native or text-embedded tool calls
   * and ensuring that raw tool call JSON and internal reasoning are NEVER
   * leaked to userVisibleText.
   */
  public static parse(
    rawContent: string,
    nativeCalls?: ModelToolCall[],
    allowList?: Set<string>
  ): ParsedModelTurn {
    const parseWarnings: string[] = [];
    let hadToolCallSyntax = false;
    let toolCalls: ModelToolCall[] = [];

    // 1. Strip hidden reasoning / chain-of-thought blocks completely
    let text = this.stripHiddenReasoning(rawContent || '');

    // 2. Handle native provider tool calls if present
    if (nativeCalls && nativeCalls.length > 0) {
      hadToolCallSyntax = true;
      for (let i = 0; i < nativeCalls.length; i++) {
        const rawCall = nativeCalls[i];
        const rawName = rawCall.function?.name || '';
        const resolvedName = this.resolveToolName(rawName, allowList) || rawName;

        let argsString = '';
        if (typeof rawCall.function?.arguments === 'string') {
          argsString = rawCall.function.arguments;
        } else if (rawCall.function?.arguments && typeof rawCall.function.arguments === 'object') {
          argsString = JSON.stringify(rawCall.function.arguments);
        } else {
          argsString = '{}';
        }

        try {
          const parsedArgs = JSON.parse(argsString);
          if (typeof parsedArgs !== 'object' || parsedArgs === null || Array.isArray(parsedArgs)) {
            parseWarnings.push(`Native tool "${rawName}" arguments must be an object.`);
            continue;
          }
          const normalizedArgs = this.normalizeArguments(resolvedName, parsedArgs);
          toolCalls.push({
            id: rawCall.id || `call-${Date.now()}-${i + 1}`,
            type: 'function',
            function: {
              name: resolvedName,
              arguments: JSON.stringify(normalizedArgs)
            }
          });
        } catch (e: any) {
          parseWarnings.push(`Failed to parse native tool arguments for "${rawName}": ${e.message}`);
        }
      }

      // Strip any accidental JSON or tool syntax echoed in the visible text
      text = this.stripToolEchoes(text);
      return {
        userVisibleText: this.cleanVisibleText(text),
        toolCalls,
        hadToolCallSyntax: true,
        parseWarnings
      };
    }

    // 3. Extract text-embedded tool calls
    // A. <tool_call> tags
    const tagMatches = this.extractTagBlocks(text);
    if (tagMatches.length > 0) {
      hadToolCallSyntax = true;
      for (const match of tagMatches) {
        text = text.replace(match.rawMatch, '');
        const extracted = this.parseJsonPayload(match.payload, allowList, parseWarnings, true);
        if (extracted) {
          toolCalls.push(...extracted);
        }
      }
    }

    // B. LOCALFORGE_TOOL_CALL protocol
    const protocolMatches = this.extractProtocolBlocks(text);
    if (protocolMatches.length > 0) {
      hadToolCallSyntax = true;
      for (const match of protocolMatches) {
        text = text.replace(match.rawMatch, '');
        const extracted = this.parseJsonPayload(match.payload, allowList, parseWarnings, true);
        if (extracted) {
          toolCalls.push(...extracted);
        }
      }
    }

    // C. Fenced code blocks with tool calls
    const fenceMatches = this.extractFencedCodeBlocks(text);
    for (const match of fenceMatches) {
      const extracted = this.parseJsonPayload(match.code, allowList, []);
      if (extracted && extracted.length > 0) {
        hadToolCallSyntax = true;
        text = text.replace(match.rawMatch, '');
        toolCalls.push(...extracted);
      }
    }

    // D. Plain / bare JSON objects and arrays embedded in text
    const bareJsonMatches = this.extractBalancedJsonBlocks(text);
    for (const match of bareJsonMatches) {
      const extracted = this.parseJsonPayload(match.json, allowList, []);
      if (extracted && extracted.length > 0) {
        hadToolCallSyntax = true;
        text = text.replace(match.rawMatch, '');
        toolCalls.push(...extracted);
      }
    }

    // Ensure userVisibleText contains no raw JSON tool call residue
    text = this.stripToolEchoes(text);
    const cleanedText = this.cleanVisibleText(text);

    return {
      userVisibleText: cleanedText,
      toolCalls,
      hadToolCallSyntax: hadToolCallSyntax || toolCalls.length > 0,
      parseWarnings
    };
  }

  /**
   * Strip <think>...</think>, <thought>...</thought>, and HTML comments.
   */
  public static stripHiddenReasoning(text: string): string {
    return text
      .replace(/<think[\s\S]*?<\/think>/gi, '')
      .replace(/<thought[\s\S]*?<\/thought>/gi, '')
      .replace(/<reasoning[\s\S]*?<\/reasoning>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
  }

  private static resolveToolName(name: string, allowList?: Set<string>): string | undefined {
    const trimmed = name.trim();
    if (allowList && allowList.has(trimmed)) {
      return trimmed;
    }
    const lower = trimmed.toLowerCase();
    if (allowList && allowList.has(lower)) {
      return lower;
    }
    const aliased = TOOL_NAME_ALIASES[lower];
    if (aliased) {
      if (!allowList || allowList.has(aliased)) {
        return aliased;
      }
    }
    if (!allowList) {
      return trimmed;
    }
    return undefined;
  }

  private static unwrapString(val: unknown, keyName?: string): string | undefined {
    const preserveWhitespace = ['content', 'target_content', 'replacement_content', 'replacement', 'text'].includes(keyName || '');
    if (typeof val === 'string') {
      return preserveWhitespace ? val : val.trim();
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      // If it's a schema definition echo ({ type: 'string', description: '...' }), ignore
      if (obj.type === 'string' && obj.description && !obj.value && !obj.text) {
        return undefined;
      }
      const candidates = keyName
        ? [keyName, 'value', 'text', 'content', 'query', 'path', 'file', 'command', 'cmd', 'target', 'replacement']
        : ['value', 'text', 'content', 'query', 'path', 'file', 'command', 'cmd', 'target', 'replacement'];
      for (const k of candidates) {
        if (typeof obj[k] === 'string' && (preserveWhitespace || (obj[k] as string).trim())) {
          return preserveWhitespace ? obj[k] as string : (obj[k] as string).trim();
        }
        if (obj[k] && typeof obj[k] === 'object') {
          const nested = this.unwrapString(obj[k], keyName);
          if (nested) return nested;
        }
      }
    }
    return undefined;
  }

  private static normalizeArguments(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    const copy = { ...args };

    if (toolName === 'list_directory') {
      for (const alias of ['directory', 'dir', 'directory_path']) {
        if (copy.path === undefined && typeof copy[alias] === 'string') copy.path = copy[alias];
        delete copy[alias];
      }
    }

    for (const key of Object.keys(copy)) {
      if (key === 'json' && ['create_file', 'write_file'].includes(toolName)) continue;
      const val = copy[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const unwrapped = this.unwrapString(val, key);
        if (unwrapped !== undefined) {
          copy[key] = unwrapped;
        }
      }
    }

    // Handle command aliases
    if (!copy.command && typeof copy.cmd === 'string') {
      copy.command = copy.cmd;
    }

    // Handle file aliases
    if (!copy.path && typeof copy.file === 'string') {
      copy.path = copy.file;
    }
    if (!copy.path && typeof copy.file_path === 'string') {
      copy.path = copy.file_path;
    }
    if (!copy.path && typeof copy.target_path === 'string') {
      copy.path = copy.target_path;
    }
    if (!copy.path && typeof copy.relative_path === 'string') {
      copy.path = copy.relative_path;
    }
    if (!copy.path && typeof copy.filename === 'string') {
      copy.path = copy.filename;
    }

    if (toolName === 'write_workspace_file' && typeof copy.content !== 'string' && typeof copy.target_content === 'string') {
      copy.content = copy.target_content;
    }

    // Handle query aliases
    if (!copy.query && typeof copy.search === 'string') {
      copy.query = copy.search;
    }

    return copy;
  }

  private static parseJsonPayload(
    rawJson: string,
    allowList?: Set<string>,
    warnings?: string[],
    explicit = false
  ): ModelToolCall[] | null {
    const trimmed = rawJson.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e: any) {
      warnings?.push(`Malformed tool JSON: ${e.message}`);
      return null;
    }

    const items = Array.isArray(parsed) ? parsed : [parsed];
    const calls: ModelToolCall[] = [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const rawName = item.name || item.tool || item.function || item.action || item.call;
      if (typeof rawName !== 'string') continue;
      const hasArguments = ['arguments', 'args', 'parameters', 'action_input', 'input', 'params'].some((key) => Object.prototype.hasOwnProperty.call(item, key));
      if (!explicit && !hasArguments && typeof item.tool !== 'string') continue;

      const rawArgs =
        item.arguments ??
        item.args ??
        item.parameters ??
        item.action_input ??
        item.input ??
        item.params ??
        {};

      let argsObj: Record<string, unknown>;
      if (typeof rawArgs === 'string') {
        try {
          argsObj = JSON.parse(rawArgs);
        } catch {
          warnings?.push(`Failed to parse JSON arguments string for tool "${rawName}".`);
          continue;
        }
      } else if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
        argsObj = rawArgs;
      } else {
        warnings?.push(`Arguments for tool "${rawName}" must be a JSON object.`);
        continue;
      }

      const resolvedName = this.resolveToolName(rawName, allowList) || rawName;

      const normalizedArgs = this.normalizeArguments(resolvedName, argsObj);
      calls.push({
        id: `text-call-${Date.now()}-${calls.length + 1}`,
        type: 'function',
        function: {
          name: resolvedName,
          arguments: JSON.stringify(normalizedArgs)
        }
      });
    }

    return calls.length > 0 ? calls : null;
  }

  private static extractTagBlocks(text: string): Array<{ rawMatch: string; payload: string }> {
    const results: Array<{ rawMatch: string; payload: string }> = [];
    const regex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      results.push({ rawMatch: match[0], payload: match[1] });
    }
    return results;
  }

  private static extractProtocolBlocks(text: string): Array<{ rawMatch: string; payload: string }> {
    const results: Array<{ rawMatch: string; payload: string }> = [];
    const marker = /LOCALFORGE_TOOL_CALL\s*:?/gi;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(text)) !== null) {
      const markerStart = match.index;
      const markerEnd = markerStart + match[0].length;
      const braceIndex = text.indexOf('{', markerEnd);
      if (braceIndex !== -1 && braceIndex - markerEnd < 10) {
        const closing = this.findMatchingClosing(text, braceIndex, '}');
        if (closing !== -1) {
          const rawMatch = text.substring(markerStart, closing + 1);
          const payload = text.substring(braceIndex, closing + 1);
          results.push({ rawMatch, payload });
        }
      }
    }
    return results;
  }

  private static extractFencedCodeBlocks(text: string): Array<{ rawMatch: string; code: string }> {
    const results: Array<{ rawMatch: string; code: string }> = [];
    const regex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      results.push({ rawMatch: match[0], code: match[1] });
    }
    return results;
  }

  private static extractBalancedJsonBlocks(text: string): Array<{ rawMatch: string; json: string }> {
    const results: Array<{ rawMatch: string; json: string }> = [];
    let i = 0;
    while (i < text.length) {
      const char = text[i];
      if (char === '{' || char === '[') {
        const start = i;
        const end = this.findMatchingClosing(text, start, char === '{' ? '}' : ']');
        if (end !== -1) {
          const candidate = text.substring(start, end + 1);
          if (
            candidate.includes('"name"') ||
            candidate.includes('"tool"') ||
            candidate.includes('"arguments"') ||
            candidate.includes('"args"')
          ) {
            results.push({ rawMatch: candidate, json: candidate });
            i = end + 1;
            continue;
          }
        }
      }
      i++;
    }
    return results;
  }

  private static findMatchingClosing(text: string, startIndex: number, closingChar: string): number {
    const openChar = text[startIndex];
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < text.length; i++) {
      const c = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === '"') {
          inString = false;
        }
        continue;
      }

      if (c === '"') {
        inString = true;
        continue;
      }

      if (c === openChar) {
        depth++;
      } else if (c === closingChar) {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }

    return -1;
  }

  private static stripToolEchoes(text: string): string {
    return text
      .replace(/```(?:json)?\s*```/g, '')
      .replace(/LOCALFORGE_TOOL_CALL\s*:?/gi, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .replace(/<\/tool_call>/gi, '')
      .replace(/<tool_call>/gi, '')
      .trim();
  }

  private static cleanVisibleText(text: string): string {
    const cleaned = text.split(/\r?\n/).filter((line) => !this.isToolErrorJson(line.trim())).join('\n').trim();
    // If leftover text is just braces or JSON punctuation
    if (/^[\[\]{}\s"':,]+$/.test(cleaned)) {
      return '';
    }

    return cleaned;
  }

  private static isToolErrorJson(line: string): boolean {
    if (!line.startsWith('{') || !line.endsWith('}')) return false;
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      return !!value && typeof value === 'object' && typeof value.error === 'string' &&
        Object.keys(value).every((key) => key === 'error' || key === 'message');
    } catch {
      return false;
    }
  }
}
