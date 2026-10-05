export function prepareDevelopmentServerCommand(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\r\n\u0000]/.test(value)) throw new Error('command must be a non-empty bounded single-line string.');
  const command = value.trim();
  const python = /^((?:python(?:3)?(?:\.exe)?|py(?:\.exe)?\s+-3)\s+-m\s+http\.server)(?:\s+(\d{1,5}))?$/i.exec(command);
  if (python) {
    const port = python[2] === undefined ? 8000 : Number(python[2]);
    if (port > 65535) throw new Error('HTTP server port must be between 0 and 65535.');
    return `${python[1]} ${port} --bind 127.0.0.1`;
  }
  if (/0\.0\.0\.0|\[::\]|--host(?:\s|=)(?:true|all)/i.test(command)) throw new Error('Use an explicit loopback bind, not a public interface.');
  if (!/127\.0\.0\.1|localhost|--host(?:\s|=)::1/i.test(command)) throw new Error('Specify 127.0.0.1 or localhost in the development-server command.');
  return command;
}
