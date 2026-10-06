import { ToolRegistry } from '../agent/toolRegistry';
import { PolicyBroker } from '../policy/policyBroker';
import { McpClient } from './mcpClient';
import { McpToolDefinition } from './types';

export class McpToolAdapter {
  public static registerMcpTools(
    registry: ToolRegistry,
    client: McpClient,
    policyBroker: PolicyBroker,
    tools: McpToolDefinition[],
    workspaceRoot: string
  ): void {
    const serverName = client.config.name;

    for (const tool of tools) {
      const namespacedName = `mcp_${serverName}_${tool.name}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');

      registry.registerTool(
        {
          type: 'function',
          function: {
            name: namespacedName,
            description: `[MCP Server: ${serverName}] ${tool.description ?? tool.name}`,
            parameters: tool.inputSchema ?? { type: 'object', properties: {} }
          }
        },
        async (args: Record<string, unknown>) => {
          // 1. Evaluate with central PolicyBroker
          const decision = policyBroker.evaluate({
            id: `mcp_req_${Date.now()}`,
            principal: { role: 'mcp_client' },
            toolName: namespacedName,
            category: 'mcp',
            source: 'mcp',
            workspaceRoot,
            riskClass: 'medium',
            args
          });

          if (decision.decision === 'deny') {
            throw new Error(`MCP tool "${namespacedName}" was blocked by security policy: ${decision.reason}`);
          }

          // 2. Call tool via McpClient
          const callResult = await client.callTool(tool.name, args);

          if (callResult.isError) {
            const errText = callResult.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('\n');
            throw new Error(`MCP tool "${namespacedName}" error: ${errText || 'Unknown failure'}`);
          }

          // 3. Format output with provenance and size bounding
          const outputText = callResult.content
            .map((c) => {
              if (c.type === 'text') return c.text ?? '';
              if (c.type === 'image') return `[Image: ${c.mimeType ?? 'image/png'}]`;
              if (c.type === 'resource') return `[Resource: ${c.data ?? ''}]`;
              return '';
            })
            .join('\n');

          // Limit output to prevent prompt flooding
          const MAX_OUTPUT_CHARS = 30000;
          const truncated = outputText.length > MAX_OUTPUT_CHARS
            ? `${outputText.slice(0, MAX_OUTPUT_CHARS)}\n... [Truncated: exceeded ${MAX_OUTPUT_CHARS} chars]`
            : outputText;

          return `<!-- MCP Tool Result: ${serverName}/${tool.name} -->\n${truncated}`;
        }
      );
    }
  }
}
