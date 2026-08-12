// Central API client.
//
// The API base is a RELATIVE path. In production nginx proxies /api to the
// Cloud Run backend (see frontend/nginx.conf.template); in dev, Vite proxies
// it (see vite.config.js). Nothing about the backend URL is baked into this
// bundle, so a changed backend URL never requires a frontend rebuild.
export const API_BASE = '/api';

const DEBUG = import.meta.env.DEV || import.meta.env.VITE_DEBUG_API === 'true';

function log(...args) {
  if (DEBUG) console.log('[api]', ...args);
}

export class ApiError extends Error {
  constructor(message, { status, body, url } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

/**
 * fetch wrapper that attaches the bearer token, parses JSON, and — most
 * importantly — logs exactly which layer failed so a broken deploy is
 * diagnosable from the browser console alone.
 */
export async function apiFetch(path, { token, method = 'GET', body, signal } = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const started = performance.now();
  log('→', method, url, { hasToken: Boolean(token) });

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (networkError) {
    // No HTTP response at all: DNS, TLS, CORS preflight, or the proxy is down.
    console.error(
      `[api] NETWORK FAILURE on ${method} ${url}. The request never got an HTTP ` +
        `response. Usually this means the nginx /api proxy is not reaching the ` +
        `backend. Check /_frontend_health and /health/db on this same origin.`,
      networkError
    );
    throw new ApiError('Network failure — could not reach the API.', { url });
  }

  const elapsed = Math.round(performance.now() - started);
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  log('←', response.status, url, `${elapsed}ms`, parsed);

  if (!response.ok) {
    if (response.status === 401) {
      console.warn(
        `[api] 401 on ${method} ${url}. The Google ID token was rejected. ` +
          `Verify the backend's Google:ClientId matches VITE_GOOGLE_CLIENT_ID, ` +
          `and check /health/auth with the same token.`
      );
    } else if (response.status === 503) {
      console.error(
        `[api] 503 on ${method} ${url}. The proxy reached nginx but not the ` +
          `backend, or the backend cannot reach MongoDB. Check /health/db.`,
        parsed
      );
    } else {
      console.error(`[api] ${response.status} on ${method} ${url}`, parsed);
    }
    throw new ApiError(`Request failed with status ${response.status}`, {
      status: response.status,
      body: parsed,
      url,
    });
  }

  return parsed;
}

/** Runs all diagnostic endpoints. Call `window.__apiDiagnostics()` in console. */
export async function runDiagnostics(token) {
  const checks = [
    ['frontend proxy', '/_frontend_health'],
    ['backend liveness', '/health'],
    ['backend config', '/health/config'],
    ['backend → mongo', '/health/db'],
    ['auth', '/health/auth'],
  ];

  const results = {};
  for (const [label, path] of checks) {
    try {
      const res = await fetch(path, {
        headers: token && path === '/health/auth' ? { Authorization: `Bearer ${token}` } : {},
      });
      const text = await res.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text.slice(0, 200);
      }
      results[label] = { status: res.status, ok: res.ok, payload };
    } catch (e) {
      results[label] = { status: 'network-error', ok: false, payload: String(e) };
    }
  }
  console.table(
    Object.entries(results).map(([check, r]) => ({ check, status: r.status, ok: r.ok }))
  );
  console.log('[diagnostics] full results:', results);
  return results;
}

if (typeof window !== 'undefined') {
  window.__apiDiagnostics = runDiagnostics;
}
