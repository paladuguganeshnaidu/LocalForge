import { SensitiveActionCategory, WindowInfo } from './types';

const SENSITIVE_WINDOW_PATTERNS: Array<{ pattern: RegExp; category: SensitiveActionCategory }> = [
  { pattern: /\b(?:password|passcode|pin|otp|authenticator|mfa|2fa)\b/i, category: 'password' },
  { pattern: /\b(?:1password|bitwarden|lastpass|keepass|credential\s*manager|keychain)\b/i, category: 'credential_manager' },
  { pattern: /\b(?:payment|checkout|credit\s*card|debit\s*card|cvv|billing|paypal|stripe)\b/i, category: 'payment' },
  { pattern: /\b(?:wire\s*transfer|bank\s*transfer|send\s*money|crypto\s*wallet)\b/i, category: 'financial_transfer' },
  { pattern: /\b(?:delete\s*account|terminate\s*account|close\s*account)\b/i, category: 'account_deletion' },
  { pattern: /\b(?:user\s*account\s*control|uac|elevate|sudo|run\s*as\s*administrator)\b/i, category: 'privilege_elevation' },
  { pattern: /\b(?:install(?:er)?|setup\.exe|msi\s*installer|package\s*manager)\b/i, category: 'software_installation' },
  { pattern: /\b(?:firewall|antivirus|security\s*center|defender\s*settings)\b/i, category: 'security_settings' },
  { pattern: /\b(?:format\s*disk|wipe\s*drive|disk\s*cleanup|partition\s*manager)\b/i, category: 'destructive_filesystem' }
];

export class SensitiveFieldDetector {
  public static detect(window?: WindowInfo, contextText?: string): { isSensitive: boolean; category?: SensitiveActionCategory; reason?: string } {
    const textToCheck = `${window?.title ?? ''} ${window?.processName ?? ''} ${contextText ?? ''}`;

    for (const entry of SENSITIVE_WINDOW_PATTERNS) {
      if (entry.pattern.test(textToCheck)) {
        return {
          isSensitive: true,
          category: entry.category,
          reason: `Detected sensitive interface pattern matching category "${entry.category}" in: "${textToCheck.trim().slice(0, 100)}"`
        };
      }
    }

    if (window?.isPrivileged) {
      return {
        isSensitive: true,
        category: 'privilege_elevation',
        reason: 'Window has elevated/administrative privileges.'
      };
    }

    return { isSensitive: false };
  }
}
