// Read-only verification: never creates accounts, orders, payments or shipments.
const input = process.argv[2];
const url = new URL(input);
if (url.protocol !== 'https:' || url.origin !== input || url.username || url.password) {
  throw new Error('Provide an exact HTTPS origin, without a trailing slash.');
}
for (const path of ['/', '/farmer', '/delivery', '/api/health', '/api/catalog', '/api/store/config']) {
  const response = await fetch(input + path, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  if (!response.headers.get('strict-transport-security')) throw new Error(`${path}: missing HTTPS protection header`);
  if (path.startsWith('/api/')) {
    const value = await response.json();
    if (path === '/api/health' && (value.application !== 'Farmconnect' || value.apiVersion !== 1 || value.database !== 'connected')) throw new Error('Incompatible/unready API');
    if (path === '/api/store/config' && value.appMode === 'demo' && (value.onlinePayments || value.courierMode !== 'demo')) throw new Error('Unsafe demo configuration');
  } else {
    const html = await response.text();
    if (!response.headers.get('content-type')?.includes('text/html') || !html.includes('id="root"')) throw new Error(`${path}: frontend missing`);
  }
  console.log(`PASS ${path}`);
}
console.log('Public HTTPS and application readiness verified. Browser and physical-phone checks are still required.');
