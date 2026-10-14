import { useEffect, useState } from 'react';
export type User = { id: string; name: string; email: string; role: 'customer'; accountType: 'consumer' | 'farmer' | 'bulk_buyer' | 'delivery'; businessName: string; farmId: string | null; accessStatus: 'approved'|'pending'|'suspended'; requestedAccountType: string };
type Portal = 'store'|'farmer'|'delivery';
async function request(path: string, body?: Record<string, string>, portal:Portal='store'): Promise<User | null> {
  const response = await fetch('/api/auth/' + (portal==='store'?'':portal+'/') + (path.endsWith('-register')?'register':path), {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? 'Please try again.');
  return result.user;
}
export function useAuth(portal:Portal='store') {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request('me',undefined,portal).then(value => { if (active) setUser(value); })
      .catch(() => { if (active) setError('Could not check your account. Make sure the backend is running.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [portal]);
  async function submit(action: 'register' | 'farmer-register' | 'delivery-register' | 'login' | 'logout', values: Record<string, string>) {
    setError('');
    try { setUser(await request(action, values,portal)); }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Unable to connect. Please try again.';
      setError(message);
      throw failure;
    }
  }
  async function refresh() { setUser(await request('me',undefined,portal)); }
  return { user, loading, error, submit, refresh };
}
export type Auth = ReturnType<typeof useAuth>;


