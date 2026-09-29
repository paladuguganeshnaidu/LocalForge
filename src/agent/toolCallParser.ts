import { ModelToolCall } from '../providers/modelProvider';

export interface ParsedModelTurn {
  userVisibleText: string;
  toolCalls: ModelToolCall[];
  hadToolCallSyntax: boolean;
  parseWarnings: string[];
}

function normalizeToolCall(value: unknown, fallbackId: string): ModelToolCall | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const fn = raw.function && typeof raw.function === 'object' ? raw.function as Record<string, unknown> : undefined;
  const name = typeof raw.name === 'string'
    ? raw.name
    : typeof raw.tool === 'string'
      ? raw.tool
      : typeof fn?.name === 'string'
        ? fn.name
        : undefined;
  const args = raw.arguments ?? raw.args ?? fn?.arguments ?? {};
  if (!name) return undefined;

  let serialized: string;
  if (typeof args === 'string') {
    serialized = args;
    try {
      serialized = JSON.stringify(JSON.parse(args));
    } catch {
      // Leave the raw string so the normal argument parser can report a useful error.
    }
  } else {
    try {
      serialized = JSON.stringify(args);
    } catch {
      return undefined;
    }
  }

  return {
    id: typeof raw.id === 'string' ? raw.id : fallbackId,
    type: 'function',
    function: { name, arguments: serialized }
  };
}

function tryParseJsonBlock(block: string): unknown {
  const trimmed = block.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function parseModelTurn(content: string, nativeCalls: ModelToolCall[] = []): ParsedModelTurn {
  const toolCalls: ModelToolCall[] = [...nativeCalls];
  const warnings: string[] = [];
  let visible = content ?? '';
  let hadSyntax = nativeCalls.length > 0;

  const appendParsed = (value: unknown, baseIndex: number): number => {
    if (Array.isArray(value)) {
      let added = 0;
      for (const [index, item] of value.entries()) {
        const normalized = normalizeToolCall(item, 'parsed-' + baseIndex + '-' + index);
        if (normalized) {
          toolCalls.push(normalized);
          added += 1;
        }
      }
      return added;
    }
    const normalized = normalizeToolCall(value, 'parsed-' + baseIndex);
    if (normalized) {
      toolCalls.push(normalized);
      return 1;
    }
    return 0;
  };

  const protocolPattern = /LOCALFORGE_TOOL_CALL\s*([\s\S]*?)(?=LOCALFORGE_TOOL_CALL|$)/gi;
  let protocolMatch: RegExpExecArray | null;
  while ((protocolMatch = protocolPattern.exec(visible)) !== null) {
    const parsed = tryParseJsonBlock(protocolMatch[1].replace(/^```(?:json)?|```$/gi, '').trim());
    if (appendParsed(parsed, toolCalls.length)) {
      hadSyntax = true;
      visible = visible.replace(protocolMatch[0], '');
    } else {
      warnings.push('A LocalForge tool-call block was detected but could not be parsed.');
    }
  }

  const tagPattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(visible)) !== null) {
    const parsed = tryParseJsonBlock(tagMatch[1]);
    if (appendParsed(parsed, toolCalls.length)) {
      hadSyntax = true;
      visible = visible.replace(tagMatch[0], '');
    } else {
      warnings.push('A <tool_call> block was detected but could not be parsed.');
    }
  }

  const fencedPattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let fencedMatch: RegExpExecArray | null;
  while ((fencedMatch = fencedPattern.exec(visible)) !== null) {
    const parsed = tryParseJsonBlock(fencedMatch[1]);
    const before = toolCalls.length;
    const added = appendParsed(parsed, before);
    if (added) {
      hadSyntax = true;
      visible = visible.replace(fencedMatch[0], '');
    }
  }

  const jsonCandidatePattern = /(?:^|\n)\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*(?=\n|$)/g;
  let candidateMatch: RegExpExecArray | null;
  while ((candidateMatch = jsonCandidatePattern.exec(visible)) !== null) {
    const parsed = tryParseJsonBlock(candidateMatch[1]);
    const before = toolCalls.length;
    const added = appendParsed(parsed, before);
    if (added) {
      hadSyntax = true;
      visible = visible.replace(candidateMatch[1], '');
    }
  }

  const deduped: ModelToolCall[] = [];
  const seen = new Set<string>();
  for (const call of toolCalls) {
    const rawArgs = typeof call.function.arguments === 'string'
      ? call.function.arguments
      : JSON.stringify(call.function.arguments);
    const key = call.function.name + ':' + rawArgs;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(call);
    }
  }

  visible = visible.replace(/^[ \t]*\n{2,}/gm, '\n').trim();

  return {
    userVisibleText: visible,
    toolCalls: deduped,
    hadToolCallSyntax: hadSyntax,
    parseWarnings: warnings
  };
}
