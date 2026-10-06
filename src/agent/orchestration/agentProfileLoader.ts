import * as fs from 'fs';
import * as path from 'path';
import { AgentRegistry, AgentRoleDefinition } from './agentRegistry';
import { ToolCategory } from '../permissionManager';
import { AgentRole } from './types';

export class AgentProfileLoader {
  public static async loadCustomProfiles(workspaceRoot: string): Promise<AgentRoleDefinition[]> {
    const loaded: AgentRoleDefinition[] = [];
    const profilesDir = path.join(workspaceRoot, '.tuxnest', 'agents');

    if (!fs.existsSync(profilesDir)) {
      return loaded;
    }

    try {
      const files = await fs.promises.readdir(profilesDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const filePath = path.join(profilesDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');

        const role = path.basename(file, '.md').toLowerCase().replace(/[^a-z0-9_]/g, '_');

        // Extract metadata from markdown headers or frontmatter
        const displayNameMatch = content.match(/^name:\s*(.+)$/m) ?? content.match(/^#\s+(.+)$/m);
        const descMatch = content.match(/^description:\s*(.+)$/m);
        const toolsMatch = content.match(/^tools:\s*(.+)$/m);

        const displayName = displayNameMatch ? displayNameMatch[1].trim() : `${role} Agent`;
        const description = descMatch ? descMatch[1].trim() : `Custom agent loaded from ${file}`;

        let allowedToolCategories: ToolCategory[] = ['read'];
        if (toolsMatch) {
          const rawTools = toolsMatch[1].split(',').map((t) => t.trim().toLowerCase());
          allowedToolCategories = rawTools.filter(
            (t): t is ToolCategory => t === 'read' || t === 'edit' || t === 'execute'
          );
          if (allowedToolCategories.length === 0) allowedToolCategories = ['read'];
        }

        const profile: AgentRoleDefinition = {
          role: role as AgentRole,
          displayName,
          description,
          allowedToolCategories,
          systemPrompt: content.trim()
        };

        AgentRegistry.registerCustomRole(profile);
        loaded.push(profile);
      }
    } catch {
      // Ignore read errors
    }

    return loaded;
  }
}
