import GoogleSignIn from './GoogleSignIn';
import { useState } from 'react';
import { Leaf, Sprout, PackageCheck, ArrowUpRight } from 'lucide-react';
import { useAuth } from '../lib/auth';
import FarmerWorkspace from './FarmerWorkspace';

export default function FarmerPortal() {
  const auth = useAuth('farmer');
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', businessName: '', phone: '' });
  async function submit() {
    if (busy) return;
    setError(''); setBusy(true);
    try {
      await auth.submit(signup ? 'farmer-register' : 'login', form);
      setForm(values => ({ ...values, password: '' }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect. Check the server terminal.'); }
    finally { setBusy(false); }
  }
  if (auth.loading) return <main className="fp-loading" role="status">Opening your farm…</main>;
  if (auth.user?.requestedAccountType === 'farmer') return <FarmerWorkspace auth={auth} />;
  return <main className="fp-entry">
    <section className="fp-story">
      <a href="/" className="fp-brand"><img src="/farmconnect.svg" alt="" />Farmconnect</a>
      <span className="fp-kicker">FOR THE PEOPLE WHO GROW.</span>
      <h1>Your harvest.<br />Your customers.<br /><em>Your business.</em></h1>
      <p>One place to list your produce, receive orders and get every harvest ready for its next home.</p>
      <div className="fp-story-features"><span><Sprout size={21} /> Your own produce listings</span><span><PackageCheck size={21} /> Retail &amp; bulk orders together</span><span><Leaf size={21} /> Verified farms, direct connections</span></div>
      <a href="/">Explore the marketplace <ArrowUpRight size={18} /></a>
    </section>
    <section className="fp-entry-form fc-account">
      {auth.user ? <><span className="fc-account-eyebrow">FARMER ACCESS</span><h2>This account shops here.</h2><p>Sign out and use your farmer account. Consumer and business accounts cannot open the farmer workspace.</p>{(error || auth.error) && <p role="alert" className="fc-order-error">{error || auth.error}</p>}<button className="fc-primary" disabled={busy} onClick={() => { setBusy(true); void auth.submit('logout', {}).catch(() => setError('Sign out failed. Try again.')).finally(() => setBusy(false)); }}>Sign out</button><a href="/">Return to marketplace</a></> : <>
        <span className="fc-account-eyebrow">FARMER WORKSPACE</span>
        <h2>{signup ? 'Let’s grow together.' : 'Welcome back, grower.'}</h2>
        <p>{signup ? 'Create your account, prepare your listings, then submit your farm for verification.' : 'Your products, orders and farm — all in one place.'}</p>
        <div className="fp-auth-tabs"><button aria-pressed={!signup} disabled={busy} onClick={() => { setSignup(false); setError(''); }}>Sign in</button><button aria-pressed={signup} disabled={busy} onClick={() => { setSignup(true); setError(''); }}>Create farmer account</button></div>
        {(error || auth.error) && <p role="alert" className="fc-order-error">{error || auth.error}</p>}
        {!signup&&<GoogleSignIn portal="farmer"/>}<form onSubmit={e => { e.preventDefault(); void submit(); }}><fieldset disabled={busy}>
          {signup && <><label>Your full name<input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>Farm / FPO name<input required minLength={2} maxLength={120} autoComplete="organization" value={form.businessName} onChange={e => setForm({ ...form, businessName: e.target.value })} /></label><label>Contact mobile<input required type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} title="10-digit Indian mobile number" autoComplete="tel-national" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label></>}
          <label>Email address<input required type="email" maxLength={254} autoComplete="username" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label>Password<input required type="password" minLength={signup ? 12 : undefined} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
          {signup && <small>Use 12–128 characters. Farm approval requires an independent manual review. Phone OTP is not connected in this version.</small>}
          <button className="fc-primary" type="submit">{busy ? 'Please wait…' : signup ? 'Create my farmer account' : 'Open my workspace'}<ArrowUpRight size={18} /></button>
        </fieldset></form>
        <p className="fp-entry-note">Farm verification protects access to selling. Creating an account alone does not publish products.</p>
      </>}
    </section>
  </main>;
}
