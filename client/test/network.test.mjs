import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, timeoutSignal } from '../src/lib/network.ts';
test('private requests enforce same-origin credentials and reject redirects', async t => {
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/auth/me'); assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    return Response.json({ user: { id: 'test' } });
  });
  assert.equal((await requestJson('/api/auth/me')).user.id, 'test');
  await assert.rejects(requestJson('https://other.example/api/auth/me'), /Invalid/);
});
test('a timed out checkout is never sent twice', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', (_path, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError'))));
  });
  await assert.rejects(requestJson('/api/orders', { method: 'POST', body: '{}' }, 5), /may have been saved/);
  assert.equal(calls, 1);
});
test('timeout covers stalled response bodies', async t => {
  t.mock.method(globalThis, 'fetch', async (_path, { signal }) => ({
    ok: true, headers: new Headers({ 'Content-Type': 'application/json' }),
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stalled body')))),
  }));
  await assert.rejects(requestJson('/api/orders', {}, 5), /Could not connect/);
});
test('validation errors retain status; HTML outages have readable errors', async t => {
  const stub = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Stock changed' } }, { status: 409 }));
  await assert.rejects(requestJson('/api/orders'), e => e.status === 409 && e.message === 'Stock changed');
  stub.mock.mockImplementation(async () => new Response('<html>Proxy unavailable</html>', { status: 503 }));
  await assert.rejects(requestJson('/api/orders'), /temporarily unavailable/);
});
test('caller cancellation and older WebView timeout are supported', async t => {
  t.mock.method(globalThis, 'fetch', async (_path, { signal }) => { if (signal.aborted) throw new Error('cancelled'); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestJson('/api/auth/me', { signal: controller.signal }), e => e.name === 'AbortError');
  const signal = timeoutSignal(2);
  await new Promise(resolve => signal.addEventListener('abort', resolve));
  assert.equal(signal.aborted, true);
});
