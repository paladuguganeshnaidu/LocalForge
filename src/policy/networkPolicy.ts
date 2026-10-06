import * as net from 'net';

export interface NetworkPolicyOptions {
  allowLocalhost?: boolean;
  domainAllowlist?: string[];
  domainDenylist?: string[];
}

export class NetworkPolicy {
  public static isPrivateOrLoopbackIp(ip: string): boolean {
    if (!net.isIP(ip)) return false;

    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(Number);
      const [a, b] = parts;

      // 0.0.0.0/8
      if (a === 0) return true;
      // 10.0.0.0/8
      if (a === 10) return true;
      // 127.0.0.0/8 (loopback)
      if (a === 127) return true;
      // 169.254.0.0/16 (link-local / cloud metadata)
      if (a === 169 && b === 254) return true;
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true;
      // 100.64.0.0/10 (CGNAT)
      if (a === 100 && b >= 64 && b <= 127) return true;

      return false;
    }

    if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      // Loopback
      if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
      // Link-local
      if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
      // Unique local address
      if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

      return false;
    }

    return false;
  }

  public static validateUrl(
    targetUrl: string,
    options: NetworkPolicyOptions = {}
  ): { safe: boolean; reason?: string; hostname?: string } {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return { safe: false, reason: `Invalid URL format: "${targetUrl}"` };
    }

    // Protocol check
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        safe: false,
        reason: `Unsupported or dangerous protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`
      };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check credentials in URL
    if (parsed.username || parsed.password) {
      return {
        safe: false,
        reason: 'Embedded user credentials in URLs are forbidden for security.'
      };
    }

    // Check localhost
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (isLocal) {
      if (options.allowLocalhost) {
        return { safe: true, hostname };
      }
      return {
        safe: false,
        reason: `Access to localhost/loopback address "${hostname}" is restricted by current policy.`,
        hostname
      };
    }

    // Check IP address directly
    if (net.isIP(hostname)) {
      if (this.isPrivateOrLoopbackIp(hostname)) {
        return {
          safe: false,
          reason: `Access to private or link-local IP "${hostname}" is blocked (SSRF defense).`,
          hostname
        };
      }
    }

    // Check denylist
    if (options.domainDenylist && options.domainDenylist.length > 0) {
      for (const denied of options.domainDenylist) {
        if (hostname === denied.toLowerCase() || hostname.endsWith(`.${denied.toLowerCase()}`)) {
          return {
            safe: false,
            reason: `Domain "${hostname}" is explicitly denied by network policy.`,
            hostname
          };
        }
      }
    }

    // Check allowlist
    if (options.domainAllowlist && options.domainAllowlist.length > 0) {
      const allowed = options.domainAllowlist.some(
        (domain) => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`)
      );
      if (!allowed) {
        return {
          safe: false,
          reason: `Domain "${hostname}" is not on the approved network allowlist.`,
          hostname
        };
      }
    }

    return { safe: true, hostname };
  }
}
