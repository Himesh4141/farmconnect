import GoogleSignIn from './GoogleSignIn';
import AccountSecurity from './AccountSecurity';
import { useRefreshTick } from '../lib/useRefreshTick';
import { useEffect, useState } from 'react';
import { Truck, PackageCheck, MapPin } from 'lucide-react';
import { useAuth, type Auth } from '../lib/auth';
import { deliveryRequest, type DeliveryJob } from '../lib/delivery';
import { deliverySteps } from '../lib/courier';
import DeliveryTimeline from './DeliveryTimeline';

function DeliveryWorkspace({ auth }: { auth: Auth }) {
  const [jobs, setJobs] = useState<DeliveryJob[]>([]), [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const [tab, setTab] = useState('Available pickups');
  const tick=useRefreshTick(!busy);
  useEffect(() => {
    let active = true; if(!jobs.length)setLoading(true); setError('');
    deliveryRequest<{ demoAvailable: boolean; shipments: DeliveryJob[] }>('/shipments')
      .then(data => { if (active) { setJobs(data.shipments); setEnabled(data.demoAvailable); } })
      .catch(e => { if (active) {setError(e.message);setJobs([]);} }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt,tick]);
  async function update(job: DeliveryJob, status?: string) {
    if (busy) return; setBusy(job.id); setError('');
    try {
      await deliveryRequest('/shipments/' + job.id + (status ? '/advance' : '/claim'), { revision: job.revision, status });
      if (!status) setTab('My deliveries');
      setAttempt(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed. Refresh your pickups.'); }
    finally { setBusy(null); }
  }
  const visible = jobs.filter(job => tab === 'Available pickups' ? !job.assigned : tab === 'History' ? job.assigned && ['delivered', 'cancelled'].includes(job.status) : job.assigned && !['delivered', 'cancelled'].includes(job.status));
  return <div className="fp-shell">
    <aside className="fp-nav"><a className="fp-brand" href="/delivery"><img src="/farmconnect.svg" alt=""/>Farmconnect</a><span>DELIVERY PARTNER</span>
      <nav>{['Available pickups', 'My deliveries', 'History'].map(label => <button className={tab === label ? 'selected' : ''} key={label} onClick={() => setTab(label)}>{label}</button>)}</nav>
      <small>{auth.user?.email}</small><button onClick={() => void auth.submit('logout', {}).catch(() => setError('Sign out failed. Try again.'))}>Sign out</button>
    </aside>
    <main className="fp-main fc-account"><header className="fp-heading"><div><span className="fc-account-eyebrow">FROM FARM GATE TO FRONT DOOR</span><h1>{tab}</h1><p>Welcome, {auth.user?.name}</p></div><button className="fc-account-button" disabled={loading || Boolean(busy)} onClick={() => setAttempt(n => n + 1)}>Refresh</button></header>
      <AccountSecurity portal="delivery"/><p className="fc-order-note"><strong>Local delivery test mode</strong><br/>Accept a test pickup to see its addresses. Only the assigned partner can update it. Updates appear on the farmer and buyer order screens. No real courier is dispatched and no money is collected.</p>
      {!loading && !enabled && <p className="fc-order-note">Delivery simulation is disabled on the server. Previous records remain available.</p>}
      {error && <p className="fc-order-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading delivery work…</p> : <div className="fc-shipment-grid">{visible.map(job => {
        const index = deliverySteps.findIndex(step => step.status === job.status), next = index >= 0 ? deliverySteps[index + 1] : undefined;
        return <article className="fc-order-card" key={job.id}><header><strong><Truck size={19}/>{job.farmName}</strong><span className="fc-demo-badge">DEMO</span></header>
          <p className="fc-tracking-code">Order {job.orderId}</p><p><MapPin size={15}/> {job.destination.city} · {job.destination.pincode}</p>
          {job.assigned ? <>
            <div className="fc-delivery-address"><strong>Collect from farm</strong><p>{job.pickup?.pickup_address}<br/>{job.pickup?.city} {job.pickup?.pincode}<br/>{job.pickup?.phone}</p><strong>Deliver to buyer</strong><p>{job.destination.name}<br/>{job.destination.line}<br/>{job.destination.city} {job.destination.pincode}<br/>{job.destination.phone}</p></div>
            <DeliveryTimeline shipment={job}/>
            {next && <button className="fc-primary" disabled={!enabled || Boolean(busy)} onClick={() => void update(job, next.status)}>{busy === job.id ? 'Saving…' : 'Test: mark ' + next.label.toLowerCase()}</button>}
          </> : <><p>Ready for collection. Contact details and full addresses appear after you accept this test pickup.</p><button className="fc-primary" disabled={!enabled || Boolean(busy)} onClick={() => void update(job)}>{busy === job.id ? 'Accepting…' : 'Accept test pickup'}</button></>}
        </article>;
      })}</div>}
      {!loading && !error && !visible.length && <p>No {tab.toLowerCase()} yet. Refresh after the farmer requests a pickup.</p>}
    </main>
  </div>;
}

export default function DeliveryPortal() {
  const auth = useAuth('delivery'), [signup, setSignup] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  async function submit() {
    if (busy) return; setBusy(true); setError('');
    try { await auth.submit(signup ? 'delivery-register' : 'login', form); setForm(previous => ({ ...previous, password: '' })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }
  async function signOut() { setBusy(true); try { await auth.submit('logout', {}); } catch { setError('Unable to sign out.'); } finally { setBusy(false); } }
  if (auth.loading) return <main className="fp-loading" role="status">Opening delivery workspace…</main>;
  if (auth.user?.accountType === 'delivery' && auth.user.accessStatus === 'approved') return <DeliveryWorkspace auth={auth}/>;
  return <main className="fp-entry"><section className="fp-story"><a href="/delivery" className="fp-brand"><img src="/farmconnect.svg" alt=""/>Farmconnect</a><span className="fp-kicker">FOR DELIVERY PARTNERS</span><h1>Fresh produce.<br/>The final mile.<br/><em>Your workspace.</em></h1><p>Receive pickup requests, manage assigned deliveries and keep farmers and buyers informed.</p><div className="fp-story-features"><span><Truck/> A separate delivery account</span><span><PackageCheck/> Only your assigned deliveries</span></div><small>Local testing only. No real courier company is connected.</small></section>
    <section className="fp-entry-form fc-account"><span className="fc-account-eyebrow">DELIVERY PARTNER ACCESS</span>
      {(error || auth.error) && <p className="fc-order-error" role="alert">{error || auth.error}</p>}
      {auth.user ? <><h2>{auth.user.accountType === 'delivery' ? auth.user.accessStatus === 'suspended' ? 'Access suspended.' : 'Approval pending.' : 'Delivery account required.'}</h2><p>{auth.user.accountType === 'delivery' ? 'An administrator must approve your delivery account before you can see or accept pickups.' : 'Buyers, farmers and store admins cannot operate deliveries. Sign out and use a dedicated delivery account.'}</p><AccountSecurity portal="delivery"/><button className="fc-primary" disabled={busy} onClick={() => void auth.refresh().catch(() => setError('Could not refresh access.'))}>Check approval</button><button className="fc-account-switch" disabled={busy} onClick={() => void signOut()}>Sign out</button></> : <>
        <h2>{signup ? 'Join as a delivery partner.' : 'Welcome back, partner.'}</h2><p>{signup ? 'Registration creates a pending delivery account. It never grants shopping or admin access.' : 'Sign in with your dedicated delivery credentials.'}</p>
        {!signup&&<GoogleSignIn portal="delivery"/>}<form onSubmit={event => { event.preventDefault(); void submit(); }}><fieldset disabled={busy}>
          {signup && <><label>Your name<input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label><label>Mobile number<input required type="tel" pattern="[6-9][0-9]{9}" maxLength={10} autoComplete="tel-national" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></label></>}
          <label>Email<input required type="email" autoComplete="username" maxLength={254} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></label><label>Password<input required type="password" minLength={signup ? 12 : 1} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}/></label>
          <button className="fc-primary">{busy ? 'Please wait…' : signup ? 'Create delivery account' : 'Sign in to delivery'}</button>
        </fieldset></form><button className="fc-account-switch" disabled={busy} onClick={() => { setSignup(!signup); setError(''); }}>{signup ? 'Already registered? Sign in' : 'New partner? Create delivery account'}</button>
      </>}
    </section></main>;
}
