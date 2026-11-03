/** Bounded requests, including parsing. Purchases and edits are never automatically replayed. */
export class RequestError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}
export async function requestJson<T>(path: string, options: RequestInit = {}, timeoutMs = 45000): Promise<T> {
  if (!path.startsWith('/api/') || path.includes('\\')) throw new RequestError('Invalid application request.');
  const controller = new AbortController(), abort = () => controller.abort(), caller = options.signal;
  caller?.addEventListener('abort', abort, { once: true });
  if (caller?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  const write = !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase());
  try {
    const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new RequestError('Farmconnect is temporarily unavailable. Please try again shortly.', response.status);
    const result = await response.json();
    if (!response.ok) throw new RequestError(typeof result?.error?.message === 'string' ? result.error.message : 'Unable to complete this request. Please try again.', response.status);
    return result as T;
  } catch (error) {
    if (caller?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (error instanceof RequestError) throw error;
    throw new RequestError(write ? 'Connection interrupted. Your change may have been saved. Check your account or orders before trying again.' : 'Could not connect to Farmconnect. Check your internet connection and try again.');
  } finally { clearTimeout(timer); caller?.removeEventListener('abort', abort); }
}
/** Compatibility for Android WebViews without AbortSignal.timeout. */
export function timeoutSignal(milliseconds: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}
