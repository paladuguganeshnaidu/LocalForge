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
      const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
      // Loopback
      if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
      // Link-local
      if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
      // Unique local address
      if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
      // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or normalized ::ffff:7f00:1)
      if (lower.startsWith('::ffff:')) {
        const sub = lower.slice(7);
        if (net.isIPv4(sub)) return this.isPrivateOrLoopbackIp(sub);
        const hexParts = sub.split(':');
        if (hexParts.length === 2) {
          const high = parseInt(hexParts[0], 16);
          const low = parseInt(hexParts[1], 16);
          const ipv4 = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
          return this.isPrivateOrLoopbackIp(ipv4);
        }
        return true;
      }

      return false;
    }

    return false;
  }

  private static readonly METADATA_HOSTNAMES = new Set([
    'instance-data',
    'metadata.google.internal',
    'metadata.internal',
    'metadata',
    'wpad'
  ]);

  public static normalizeAndParseIp(hostname: string): string | null {
    const clean = hostname.replace(/^\[|\]$/g, '').trim().toLowerCase();
    // IPv4-mapped IPv6: ::ffff:127.0.0.1
    if (clean.startsWith('::ffff:')) {
      const embedded = clean.slice(7);
      if (net.isIPv4(embedded)) return embedded;
    }
    // Standard IP
    if (net.isIP(clean)) return clean;
    // Hex integer: 0x7f000001
    if (/^0x[0-9a-f]+$/i.test(clean)) {
      const num = parseInt(clean, 16);
      if (!isNaN(num) && num >= 0 && num <= 0xffffffff) {
        return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
      }
    }
    // Decimal integer: 2130706433
    if (/^\d{8,10}$/.test(clean)) {
      const num = parseInt(clean, 10);
      if (!isNaN(num) && num >= 0 && num <= 0xffffffff) {
        return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
      }
    }
    // Octal or hex parts: e.g. 0177.0.0.1 or 0x7f.0.0.1
    const parts = clean.split('.');
    if (parts.length === 4) {
      const octets: number[] = [];
      for (const p of parts) {
        let val: number;
        if (/^0x[0-9a-f]+$/i.test(p)) val = parseInt(p, 16);
        else if (/^0[0-7]+$/.test(p)) val = parseInt(p, 8);
        else if (/^\d+$/.test(p)) val = parseInt(p, 10);
        else return null;
        if (isNaN(val) || val < 0 || val > 255) return null;
        octets.push(val);
      }
      return octets.join('.');
    }
    return null;
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

    const rawHostname = parsed.hostname.toLowerCase();
    const resolvedIp = this.normalizeAndParseIp(rawHostname);
    const hostname = resolvedIp || rawHostname;

    // Check credentials in URL
    if (parsed.username || parsed.password) {
      return {
        safe: false,
        reason: 'Embedded user credentials in URLs are forbidden for security.'
      };
    }

    // Check cloud metadata hostnames
    if (this.METADATA_HOSTNAMES.has(rawHostname)) {
      return {
        safe: false,
        reason: `Access to cloud metadata endpoint "${rawHostname}" is blocked (SSRF defense).`,
        hostname: rawHostname
      };
    }

    // Check localhost
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || rawHostname === 'localhost';
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
