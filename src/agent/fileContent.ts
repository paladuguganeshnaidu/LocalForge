export function materializeFileContent(args: Record<string, unknown>, maximumBytes = 512 * 1024): string {
  let content: string;
  if (args.json !== undefined) {
    if (args.content !== undefined) throw new Error('Provide either content or json, not both.');
    if (typeof args.path !== 'string' || !/\.json$/i.test(args.path.trim())) throw new Error('The json argument is only available for .json files.');
    if (!args.json || typeof args.json !== 'object' || Array.isArray(args.json)) throw new Error('The json argument must be a JSON object, not escaped file text.');
    content = JSON.stringify(args.json, null, 2) + '\n';
  } else {
    if (typeof args.content !== 'string') throw new Error('Provide complete file text in content, or a JSON object in json for a .json file.');
    content = args.content;
  }
  if (Buffer.byteLength(content, 'utf8') > maximumBytes) throw new Error('File content exceeds the 512KB limit.');
  return content;
}
