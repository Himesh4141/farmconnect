import type { DemoShipment } from './courier';
export type DeliveryJob = DemoShipment & {
  assigned: boolean;
  destination: { name?: string; phone?: string; line?: string; city: string; pincode: string };
  pickup: { phone: string; pickup_address: string; city: string; pincode: string } | null;
};
export async function deliveryRequest<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch('/api/delivery' + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Connection interrupted. Refresh pickups to check the latest status before retrying.'); }
  let data; try { data = await response.json(); } catch { throw new Error('Could not read the response. Check the backend terminal.'); }
  if (!response.ok) throw new Error(data.error?.message ?? 'Unable to load delivery work.');
  return data as T;
}
