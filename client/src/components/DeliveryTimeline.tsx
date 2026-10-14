import { Check, Truck } from 'lucide-react';
import './delivery.css';
import { deliverySteps, type DemoShipment } from '../lib/courier';

export default function DeliveryTimeline({ shipment }: { shipment: DemoShipment }) {
  const index = deliverySteps.findIndex(step => step.status === shipment.status);
  return <div className="fc-delivery">
    <div className="fc-delivery-title"><Truck size={20}/><strong>{shipment.isDemo?'Delivery simulation':shipment.provider+' delivery'}</strong>{shipment.isDemo&&<span className="fc-demo-badge">DEMO</span>}</div>
    <p className="fc-tracking-code">{shipment.trackingNumber}</p>
    {shipment.events.some(event => event.status === 'partner_assigned') && <p>Accepted by a delivery partner.</p>}
    {shipment.status === 'cancelled' && <p className="fc-order-note" role="status">Order cancelled. This simulation has stopped. Earlier test events are kept below.</p>}
    {shipment.providerStatus&&<p>Courier update: {shipment.providerStatus}</p>}
    <ol className="fc-delivery-timeline" aria-label="Delivery progress">
      {deliverySteps.map((step, i) => {
        const event = shipment.events.find(item => item.status === step.status);
        return <li className={event ? 'complete' : ''} key={step.status} aria-current={i === index ? 'step' : undefined}>
          <span className="fc-delivery-dot">{event ? <Check size={12}/> : i + 1}</span>
          <div><strong>{step.label}</strong><small>{event ? new Date(event.createdAt).toLocaleString('en-IN') : 'Waiting'}</small></div>
        </li>;
      })}
    </ol>
    <small>{shipment.isDemo?'Test delivery events only. No real courier is dispatched. Any online test payment is shown separately in your order.':'Updates verified with the courier. The time shown is when Farmconnect received each update.'}</small>
  </div>;
}
