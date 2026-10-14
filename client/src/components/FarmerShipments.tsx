import { useRefreshTick } from '../lib/useRefreshTick';
import { useEffect, useState } from 'react';
import { Package, RefreshCw } from 'lucide-react';
import { marketplaceRequest } from '../lib/marketplace';
import type { DemoShipment } from '../lib/courier';
import DeliveryTimeline from './DeliveryTimeline';

type Shipment = {
  orderId: string; preparationStatus: string;
  destination: { city: string; pincode: string };
  events: { status: string; createdAt: number }[];
  external?:DemoShipment|null; demo: DemoShipment | null;
};
export default function FarmerShipments({ refresh = 0 }: { refresh?: number }) {
  const [rows, setRows] = useState<Shipment[]>([]), [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0), [booking, setBooking] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [live,setLive]=useState(false);
  const tick=useRefreshTick(!booking);
  useEffect(() => {
    let active = true; if(!rows.length)setLoading(true); setError('');
    marketplaceRequest<{ courierAvailable:boolean; demoAvailable: boolean; shipments: Shipment[] }>('/shipments')
      .then(data => { if (active) { setRows(data.shipments); setEnabled(data.demoAvailable); setLive(data.courierAvailable); } })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, refresh,tick]);
  async function book(id: string) {
    if (booking) return; setBooking(id); setError(''); setNotice('');
    try {
      const result = await marketplaceRequest<{ shipment: DemoShipment }>('/shipments/' + id + '/book', { confirmDemo: true });
      setRows(previous => previous.map(row => row.orderId === id ? { ...row, demo: result.shipment } : row));
      setNotice('Test pickup saved. Approved delivery partners can now accept this pickup in their delivery workspace.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Pickup request failed. Refresh before retrying.'); }
    finally { setBooking(null); }
  }
  return <>
    <div className="fc-order-note"><strong>{live?'Courier tracking connected':enabled ? 'Local delivery demo is enabled' : 'Courier booking unavailable'}</strong><p>{live?'Your operations team arranges pickup with the courier. Verified tracking updates appear here automatically.':enabled ? 'Try the pickup and tracking flow without a courier account. These are simulated deliveries; nobody will arrive to collect the order.' : 'A live courier is not connected. Enable the local delivery demo using the setup guide to test this workflow.'}</p></div>
    <button className="fc-account-switch" disabled={loading || Boolean(booking)} onClick={() => setAttempt(n => n + 1)}><RefreshCw size={16}/> Refresh tracking</button>
    {notice && <p className="fc-order-note" role="status">{notice}</p>}
    {error && <p className="fc-order-error" role="alert">{error}</p>}
    {loading ? <p role="status">Loading shipments…</p> : <div className="fc-shipment-grid">{rows.map(row => <article className="fc-order-card" key={row.orderId}>
      <header><strong><Package size={18}/> {row.preparationStatus.replaceAll('_', ' ')}</strong><span>{row.destination.city} · {row.destination.pincode}</span></header>
      <p className="fc-tracking-code">Order {row.orderId}</p>
      {row.external ? <DeliveryTimeline shipment={row.external}/> : row.demo ? <DeliveryTimeline shipment={row.demo}/> : <>
        <p>{row.preparationStatus === 'packed' ? 'Mark this order ready for pickup in Orders first.' : live?'Your operations team will arrange courier collection. Tracking appears here after the shipment is connected.':'Your produce is ready. Request a test pickup to begin the delivery simulation.'}</p>
        {!live&&<button className="fc-primary" disabled={!enabled || row.preparationStatus !== 'ready_for_pickup' || Boolean(booking)} onClick={() => void book(row.orderId)}>{booking === row.orderId ? 'Saving test pickup…' : 'Request test pickup'}</button>}
      </>}
      <details className="fc-preparation-events"><summary>Preparation history</summary><ol>{row.events.map((event, i) => <li key={i}>{event.status.replaceAll('_', ' ')} · {new Date(event.createdAt).toLocaleString('en-IN')}</li>)}</ol></details>
    </article>)}</div>}
    {!loading && !error && !rows.length && <p>Pack an order first. It will appear here ready for the next step.</p>}
  </>;
}
