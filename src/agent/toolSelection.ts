import { ModelToolDefinition } from '../providers/modelProvider';
import { positiveTaskRequirements } from './taskRequirements';

const defaultTools = ['discover_tools', 'update_plan', 'list_directory', 'read_file', 'create_file', 'create_directory', 'write_file', 'edit_workspace_file', 'run_command', 'inspect_package_scripts', 'install_dependencies', 'install_packages', 'run_build', 'start_dev_server', 'process_status', 'browser_action', 'read_web_page', 'search_text', 'file_stat'];

export function selectToolDefinitions(available: ModelToolDefinition[], maximum: number, requested: string[] = [], task?: string): ModelToolDefinition[] {
  if (!Number.isFinite(maximum) || maximum < 4 || available.length <= maximum) return available;
  const definitions = new Map(available.map(tool => [tool.function.name, tool]));
  const taskTools = task !== undefined && !/\b(?:website|web\s*(?:app|site)|frontend|landing|portfolio|browser|html|react|vue|svelte|astro)\b/i.test(positiveTaskRequirements(task))
    ? ['update_plan', 'list_directory', 'read_file', 'create_file', 'create_directory', 'write_file', 'edit_workspace_file', 'run_command', 'search_text', 'file_stat', 'run_tests', 'run_lint', 'delegate_task', 'process_status']
    : defaultTools;
  const names = [...new Set(['discover_tools', ...requested, ...taskTools, ...definitions.keys()])];
  return names.filter(name => definitions.has(name)).slice(0, Math.floor(maximum)).map(name => definitions.get(name)!);
}
