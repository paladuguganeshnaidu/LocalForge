export type ToolCategory = 'read' | 'edit' | 'execute';
export type ToolRiskLevel = 'read_only' | 'low_risk' | 'high_risk' | 'destructive' | 'network' | 'privileged';
export type ToolAccessScope = 'file' | 'workspace' | 'machine';
export type ToolActivity = 'Reading' | 'Searching' | 'Editing' | 'Running' | 'Browser' | 'Working' | 'Optimising';

export interface ToolDescriptor {
  readonly name: string;
  readonly category: ToolCategory;
  readonly riskLevel: ToolRiskLevel;
  readonly mutability: 'none' | 'workspace' | 'process' | 'artifact' | 'external';
  readonly scopes: readonly ToolAccessScope[];
  readonly approval: 'read_only' | 'review' | 'explicit';
  readonly pathArguments: readonly string[];
  readonly network: boolean;
  readonly processExecution: boolean;
  readonly reviewable: boolean;
  readonly reversible: boolean;
  readonly activity: ToolActivity;
}

const projectScopes: readonly ToolAccessScope[] = ['workspace', 'machine'];
const allScopes: readonly ToolAccessScope[] = ['file', 'workspace', 'machine'];

function read(name: string, activity: ToolActivity = 'Reading', paths: string[] = []): ToolDescriptor {
  return { name, category: 'read', riskLevel: 'read_only', mutability: 'none', scopes: paths.length ? allScopes : projectScopes, approval: 'read_only', pathArguments: paths, network: false, processExecution: false, reviewable: false, reversible: false, activity };
}

function edit(name: string, destructive = false, paths: string[] = ['path']): ToolDescriptor {
  return { name, category: 'edit', riskLevel: destructive ? 'destructive' : 'low_risk', mutability: 'workspace', scopes: paths.length === 1 && paths[0] === 'path' ? allScopes : projectScopes, approval: destructive ? 'explicit' : 'review', pathArguments: paths, network: false, processExecution: false, reviewable: true, reversible: true, activity: 'Editing' };
}

function processTool(name: string, category: ToolCategory = 'execute'): ToolDescriptor {
  return { name, category, riskLevel: 'high_risk', mutability: 'process', scopes: projectScopes, approval: 'explicit', pathArguments: [], network: false, processExecution: true, reviewable: false, reversible: false, activity: 'Running' };
}

const descriptors: ToolDescriptor[] = [
  { ...read('update_plan', 'Working'), scopes: allScopes },
  read('discover_tools', 'Searching'),
  read('search_workspace', 'Searching'), read('read_workspace_file', 'Reading', ['path']),
  read('read_file', 'Reading', ['path']), read('read_files', 'Reading', ['paths']), read('list_directory'),
  read('search_text', 'Searching'), read('search_files', 'Searching'), read('get_diagnostics'),
  read('get_editor_context'), read('inspect_project'), read('get_edit_recovery'),
  processTool('git_status', 'read'), processTool('git_diff', 'read'), processTool('git_log', 'read'),
  processTool('git_commit'), processTool('run_command'), processTool('run_test'),
  edit('write_workspace_file'), edit('edit_workspace_file'), edit('write_file'), edit('create_file'),
  edit('replace_range'), edit('delete_file', true), edit('move_file', true, ['source_path', 'destination_path']),
  edit('rollback_changes', true, ['files']),
  { ...edit('create_artifact', false, []), mutability: 'artifact', reviewable: false, reversible: false },
  { ...read('read_web_page', 'Searching'), scopes: allScopes, riskLevel: 'network', network: true, approval: 'explicit' },
  { ...read('read_machine_file', 'Reading', ['path']), scopes: ['machine'], riskLevel: 'high_risk', approval: 'explicit' },
  { ...read('list_machine_directory', 'Reading', ['path']), scopes: ['machine'], riskLevel: 'high_risk', approval: 'explicit' },
  { ...processTool('browser_action'), network: true, riskLevel: 'network', activity: 'Browser' },
  { ...edit('create_directory'), approval: 'explicit', reviewable: false, reversible: false },
  read('file_stat', 'Reading', ['path']), read('inspect_package_scripts'), read('process_status'),
  { ...read('delegate_task', 'Working'), scopes: ['workspace'], approval: 'explicit' },
  { ...processTool('register_workflow_tool'), scopes: ['workspace'], riskLevel: 'privileged', mutability: 'artifact', processExecution: false, activity: 'Working' },
  { ...processTool('install_dependencies'), network: true }, { ...processTool('install_packages'), network: true }, processTool('run_build'), processTool('run_lint'),
  processTool('start_dev_server'), processTool('stop_process')
];

const policies = new Map(descriptors.map((descriptor) => [descriptor.name, freezeToolDescriptor(descriptor)]));

export function freezeToolDescriptor(descriptor: ToolDescriptor): ToolDescriptor {
  validateToolDescriptor(descriptor);
  return Object.freeze({ ...descriptor, scopes: Object.freeze([...descriptor.scopes]), pathArguments: Object.freeze([...descriptor.pathArguments]) });
}

export function validateToolDescriptor(descriptor: ToolDescriptor): void {
  if (!descriptor || !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/.test(descriptor.name)) throw new Error('Invalid tool descriptor identity.');
  if (!['read', 'edit', 'execute'].includes(descriptor.category) || !['read_only', 'low_risk', 'high_risk', 'destructive', 'network', 'privileged'].includes(descriptor.riskLevel)) throw new Error('Invalid tool category or risk.');
  if (!['none', 'workspace', 'process', 'artifact', 'external'].includes(descriptor.mutability) || !['read_only', 'review', 'explicit'].includes(descriptor.approval)) throw new Error('Invalid tool mutation or approval policy.');
  if (!Array.isArray(descriptor.scopes) || !descriptor.scopes.length || descriptor.scopes.some((scope) => !['file', 'workspace', 'machine'].includes(scope)) || new Set(descriptor.scopes).size !== descriptor.scopes.length) throw new Error('Invalid tool access scopes.');
  if (!Array.isArray(descriptor.pathArguments) || descriptor.pathArguments.some((argument) => typeof argument !== 'string' || !argument)) throw new Error('Invalid tool path arguments.');
  if (['network', 'processExecution', 'reviewable', 'reversible'].some((key) => typeof descriptor[key as keyof ToolDescriptor] !== 'boolean') || !['Reading', 'Searching', 'Editing', 'Running', 'Browser', 'Working', 'Optimising'].includes(descriptor.activity)) throw new Error('Invalid tool capability metadata.');
  if ((descriptor.network || descriptor.processExecution || ['destructive', 'privileged', 'high_risk', 'network'].includes(descriptor.riskLevel)) && descriptor.approval !== 'explicit') throw new Error('Consequential tools require explicit approval.');
  if (descriptor.approval === 'read_only' && (descriptor.category !== 'read' || descriptor.mutability !== 'none')) throw new Error('Only immutable read tools may use read-only approval.');
  if (descriptor.reviewable && descriptor.category !== 'edit') throw new Error('Only edit tools may declare reviewable changes.');
}

export function getBuiltinToolDescriptor(name: string): ToolDescriptor | undefined { return policies.get(name); }
export function getBuiltinToolDescriptors(): ToolDescriptor[] { return [...policies.values()]; }

export function describeExternalTool(name: string, category: ToolCategory = 'execute'): ToolDescriptor {
  return freezeToolDescriptor({ ...processTool(name, category), mutability: 'external', activity: 'Working' });
}
