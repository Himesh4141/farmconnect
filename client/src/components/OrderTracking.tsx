import { useRefreshTick } from '../lib/useRefreshTick';
import { useEffect, useState } from 'react';
import { orderRequest } from '../lib/orders';
import type { TrackingResponse } from '../lib/courier';
import DeliveryTimeline from './DeliveryTimeline';

export default function OrderTracking({ orderId }: { orderId: string }) {
  const [data, setData] = useState<TrackingResponse | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const tick=useRefreshTick(Boolean(data)&&!busy);
  useEffect(()=>{if(data)void load();},[tick]);
  async function load() {
    if (busy) return; setBusy(true); setError('');
    try { setData(await orderRequest<TrackingResponse>('/' + orderId + '/tracking')); }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Unable to load tracking.'); }
    finally { setBusy(false); }
  }
  return <div className="fc-order-tracking">
    <button className="fc-account-switch" disabled={busy} onClick={() => void load()}>{busy ? 'Checking tracking…' : data ? 'Refresh delivery tracking' : 'View delivery tracking'}</button>
    {error && <p className="fc-order-error" role="alert">{error}</p>}
    {data && (!data.shipments.length ? <p>Your farmer is preparing this order. Tracking appears when pickup is arranged.</p> : data.shipments.map(shipment => <div key={shipment.id}><strong>{shipment.farmName}</strong><DeliveryTimeline shipment={shipment}/></div>))}
  </div>;
}
