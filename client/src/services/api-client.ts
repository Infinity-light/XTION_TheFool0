/**
 * API Client — XTION_TheFool0
 *
 * Shared HTTP client that:
 *   - Reads the API key from localStorage ('openclaw_key')
 *   - Adds Authorization: Bearer <key> header to all requests
 *   - Uses Vite proxy base path (/api → http://localhost:8080/api)
 *   - Handles errors uniformly, throwing ApiError on non-2xx responses
 *
 * Requirements: 8.1, 8.2
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const API_KEY_STORAGE_KEY = 'openclaw_key';
const ADMIN_TOKEN_STORAGE_KEY = 'openclaw_admin_token';

function hydrateStorageFromUrl(queryKey: string, storageKey: string): string {
  const params = new URLSearchParams(window.location.search);
  const valueFromUrl = params.get(queryKey)?.trim() ?? '';
  if (valueFromUrl) {
    localStorage.setItem(storageKey, valueFromUrl);
    return valueFromUrl;
  }
  return localStorage.getItem(storageKey)?.trim() ?? '';
}

function getApiKey(): string {
  return hydrateStorageFromUrl('key', API_KEY_STORAGE_KEY);
}

export function getAdminToken(): string {
  return hydrateStorageFromUrl('admin_token', ADMIN_TOKEN_STORAGE_KEY);
}

export function setAdminToken(token: string): void {
  const normalized = token.trim();
  if (normalized) {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, normalized);
  } else {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  }
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
}

function buildHeaders(path: string, extra?: Record<string, string>): Record<string, string> {
  const key = getApiKey();
  const adminToken = path.startsWith('/api/admin/') ? getAdminToken() : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (key) {
    headers['Authorization'] = `Bearer ${key}`;
  }
  if (adminToken) {
    headers['X-Admin-Token'] = adminToken;
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    // 204 No Content
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }
  let code = `HTTP_${res.status}`;
  let message = res.statusText;
  try {
    const body = await res.json() as { error?: { code?: string; message?: string } };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
    }
  } catch {
    // ignore parse errors
  }
  throw new ApiError(res.status, code, message);
}

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return fetch(path, { headers: buildHeaders(path) }).then((r) => handleResponse<T>(r));
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return fetch(path, {
      method: 'POST',
      headers: buildHeaders(path),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handleResponse<T>(r));
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return fetch(path, {
      method: 'PUT',
      headers: buildHeaders(path),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handleResponse<T>(r));
  },

  delete<T>(path: string): Promise<T> {
    return fetch(path, {
      method: 'DELETE',
      headers: buildHeaders(path),
    }).then((r) => handleResponse<T>(r));
  },
};

export default apiClient;
