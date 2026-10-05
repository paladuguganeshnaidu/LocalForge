import { createHash } from 'node:crypto';

export const defaultCompatibleEndpoints = 'http://127.0.0.1:1234/v1,http://127.0.0.1:8080/v1,http://127.0.0.1:8000/v1';
export interface EndpointConfiguration { ollamaEndpoint?: string; openAiEndpoints?: string; openAiEndpoint?: string }
export interface ParsedEndpoints { endpoints: string[]; errors: string[] }

export function normalizeEndpoint(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value.trim())) throw new Error('Use a bounded absolute HTTP(S) base URL without whitespace or backslashes.');
  const endpoint = new URL(value.trim());
  if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.hostname || endpoint.username || endpoint.password || value.includes('?') || value.includes('#')) throw new Error('Endpoint URLs must use HTTP(S), without credentials, query parameters or fragments.');
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
  return endpoint.toString().replace(/\/+$/, '');
}

export function parseCompatibleEndpoints(value: string): ParsedEndpoints {
  if (typeof value !== 'string' || value.length > 16384) return { endpoints: [], errors: ['Compatible endpoint configuration exceeds 16,384 characters.'] };
  const entries = value.split(/[\r\n,]+/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length > 32) return { endpoints: [], errors: ['Configure at most 32 compatible endpoint entries.'] };
  const endpoints = new Set<string>();
  const errors: string[] = [];
  entries.forEach((entry, index) => {
    try { endpoints.add(normalizeEndpoint(entry)); }
    catch { errors.push(`Compatible endpoint ${index + 1} is invalid. Use HTTP(S) without credentials, query parameters or fragments.`); }
  });
  return { endpoints: [...endpoints], errors };
}

export function compatibleProviderId(endpoint: string): string {
  return 'openai-' + createHash('sha256').update(normalizeEndpoint(endpoint)).digest('hex').slice(0, 24);
}

export function canonicalModelId(providerId: string, name: string): string { return `${providerId}:${encodeURIComponent(name)}`; }

export function fetchModelEndpoint(url: string, options: RequestInit, transport: typeof fetch = fetch): Promise<Response> { return transport(url, { ...options, redirect: 'error' }); }
