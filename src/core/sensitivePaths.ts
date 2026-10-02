export function isSensitivePath(path: string): boolean {
  return /(?:^|[\\/])(?:\.env(?:[.\\/]|$)|\.ssh(?:[\\/]|$)|\.aws(?:[\\/]|$)|\.npmrc$|id_rsa(?:[.\\/]|$)|id_ed25519(?:[.\\/]|$)|credentials(?:[.\\/]|$))|\.(?:pem|key|p12|pfx)$/i.test(path);
}
