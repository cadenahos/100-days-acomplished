import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch, ApiError, API_BASE } from './api';

describe('apiFetch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const respond = (status, body, { asText = false } = {}) =>
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (asText ? body : JSON.stringify(body)),
    });

  it('calls the relative /api base, never an absolute host', async () => {
    globalThis.fetch = respond(200, { ok: true });
    await apiFetch('/Challenges/my', { token: 't' });

    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/Challenges/my`);
    expect(url.startsWith('/')).toBe(true);   // same-origin; nginx proxies it
    expect(url).not.toMatch(/^https?:\/\//);
  });

  it('attaches the bearer token', async () => {
    globalThis.fetch = respond(200, {});
    await apiFetch('/Challenges/my', { token: 'abc123' });

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer abc123');
  });

  it('omits the Authorization header when there is no token', async () => {
    globalThis.fetch = respond(200, {});
    await apiFetch('/Challenges/my', {});

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('sends JSON content-type and a serialised body only when a body is given', async () => {
    globalThis.fetch = respond(200, {});
    await apiFetch('/Challenges', { token: 't', method: 'POST', body: { name: 'Run' } });

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'Run' }));
  });

  it('does not set a content-type on a bodyless request', async () => {
    globalThis.fetch = respond(200, {});
    await apiFetch('/Challenges/1', { token: 't', method: 'DELETE' });

    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('returns parsed JSON on success', async () => {
    globalThis.fetch = respond(200, { id: '7', name: 'Run' });
    await expect(apiFetch('/Challenges/7', { token: 't' }))
      .resolves.toEqual({ id: '7', name: 'Run' });
  });

  it('returns null for an empty 204 body', async () => {
    globalThis.fetch = respond(204, '', { asText: true });
    await expect(apiFetch('/Challenges/7', { token: 't', method: 'DELETE' }))
      .resolves.toBeNull();
  });

  it('falls back to raw text when the response is not JSON', async () => {
    globalThis.fetch = respond(200, 'plain text', { asText: true });
    await expect(apiFetch('/x', {})).resolves.toBe('plain text');
  });

  // The failure modes below are exactly what a broken deploy produces, so the
  // distinctions matter more than the happy path.

  it('throws ApiError with no status when the network fails outright', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await apiFetch('/Challenges/my', { token: 't' }).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBeUndefined();
    expect(err.message).toMatch(/network/i);
  });

  it('surfaces a 401 as ApiError with status 401', async () => {
    globalThis.fetch = respond(401, { message: 'nope' });

    const err = await apiFetch('/Challenges/my', { token: 'bad' }).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });

  it('exposes the parsed body on a 409 so the UI can show the rule message', async () => {
    globalThis.fetch = respond(409, {
      reason: 'AlreadyCheckedToday',
      message: "You've already checked today.",
    });

    const err = await apiFetch('/Challenges/1/check', { token: 't', method: 'POST' }).catch(e => e);
    expect(err.status).toBe(409);
    expect(err.body.reason).toBe('AlreadyCheckedToday');
    expect(err.body.message).toMatch(/already checked/i);
  });

  it('surfaces a 503 (proxy up, backend or Mongo down)', async () => {
    globalThis.fetch = respond(503, { error: 'backend_unreachable' });

    const err = await apiFetch('/Challenges/my', { token: 't' }).catch(e => e);
    expect(err.status).toBe(503);
    expect(err.body.error).toBe('backend_unreachable');
  });
});
