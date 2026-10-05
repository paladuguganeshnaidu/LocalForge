import { materializeFileContent } from './fileContent';

export function validateGeneratedFile(task: string, tool: string, args: Record<string, unknown>): string | undefined {
  if (!['create_file', 'write_file', 'write_workspace_file'].includes(tool) || typeof args.path !== 'string' || typeof args.content !== 'string' && args.json === undefined) return undefined;
  if (/\b(?:end|finish)\s+with\s+(?:a\s+)?(?:trailing\s+)?newline\b/i.test(task) && !materializeFileContent(args).endsWith('\n')) return 'The task explicitly requires a trailing newline. Include that newline in the complete content argument and retry; no file was written.';
  if (!/(?:^|[\\/])package\.json$/i.test(args.path) || !/\b(?:build|create|initialize|bootstrap|develop)\b/i.test(task) || !/\b(?:website|landing|application|project|portfolio)\b/i.test(task) || /\b(?:intentionally|deliberately)\b.*\b(?:invalid|malformed|broken)\b/i.test(task)) return undefined;
  try {
    const manifest = JSON.parse(materializeFileContent(args));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return 'package.json must contain a JSON object. No file was written.';
    if (manifest.scripts !== undefined && (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts) || Object.values(manifest.scripts).some(script => typeof script !== 'string' || !script.trim()))) return 'package.json scripts must map script names to non-empty command strings. Correct the complete manifest before retrying; no file was written.';
    const build = typeof manifest.scripts?.build === 'string' ? manifest.scripts.build.trim() : '';
    const requestedBuild = /\bbuild\s+(?:the\s+)?project\b|\bproduction[ -]quality\b/i.test(task) && !/\bno\s+build\s+(?:step|script)|\b(?:do not|don't)\s+build\b/i.test(task);
    if (requestedBuild && !build) return 'package.json is missing the requested build script. Choose a toolchain appropriate to the task and declare its actual build command and needed dependencies. Create its source/configuration next, install dependencies and execute the build; a start script alone is not a build. No file was written.';
    if (requestedBuild && !/[;&|]/.test(build) && /^(?:echo(?:\s+.*)?|true|exit\s+0)$/i.test(build)) return 'package.json build script only prints a message or exits; it does not build or validate the requested project. Provide an actual framework build or a static-site build script that checks and produces the site assets. Do not claim completion from a placeholder success message. No file was written.';
  } catch (error) {
    return `package.json content is invalid JSON: ${error instanceof Error ? error.message : String(error)}. Prefer create_file or write_file with the actual object in json and no content field; the tool serializes it correctly. If using content, send actual complete JSON file text, not a double-escaped document. Do not put literal backslash-n characters between properties; escape quotes only inside JSON string values. Correct the arguments and retry. No file was written.`;
  }
  return undefined;
}
