/**
 * Configuration and URL utilities for the AI Mystery Room backend API.
 * Uses the VITE_API_BASE_URL environment variable for production deployments (e.g. Vercel -> Render)
 * while smoothly defaulting to '/api' for local Vite dev-server proxying.
 */

export function getApiBaseUrl(): string {
  const envUrl = (
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_API_BASE_URL) ||
    ''
  ).trim();

  if (!envUrl) {
    return '/api';
  }

  const clean = envUrl.replace(/\/+$/, '');
  return clean.endsWith('/api') ? clean : `${clean}/api`;
}

export const API_BASE_URL = getApiBaseUrl();

/**
 * Returns the backend host origin without the /api suffix.
 * e.g. "https://ai-mystery-room-msfn.onrender.com"
 */
export function getBackendOrigin(): string {
  const baseUrl = getApiBaseUrl();
  if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
    return baseUrl.replace(/\/api\/?$/, '');
  }
  return '';
}

/**
 * Resolves media URLs (forensic photos, CCTV recordings) returned by the backend.
 * Prepends backend host origin for relative "/api/media/..." paths in production,
 * or keeps them relative in local development to utilize Vite's proxy.
 */
export function resolveMediaUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (
    url.startsWith('data:') ||
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('blob:')
  ) {
    return url;
  }
  if (url.startsWith('/')) {
    const origin = getBackendOrigin();
    return origin ? `${origin}${url}` : url;
  }
  return url;
}
