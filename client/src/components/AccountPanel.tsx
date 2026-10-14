import CustomerProfile from './CustomerProfile';
import GoogleSignIn from './GoogleSignIn';
import AccountSecurity from './AccountSecurity';
import { adminRequest } from '../lib/admin';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Leaf, LogOut } from 'lucide-react';
import type { Auth } from '../lib/auth';
export default function AccountPanel({ auth, onSaved, onHelp, onOrders, onCheckout, onAdmin, onFarmer, onBulk, onApply }: { auth: Auth; onSaved:()=>void; onHelp:()=>void; onOrders: () => void; onCheckout: () => void; onAdmin: () => void; onFarmer: () => void; onBulk: () => void; onApply: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [canAdmin,setCanAdmin]=useState(false);
  useEffect(()=>{let active=true;setCanAdmin(false);if(auth.user)adminRequest<{isAdmin:boolean}>('/access').then(data=>{if(active)setCanAdmin(data.isAdmin);}).catch(()=>{});return()=>{active=false;};},[auth.user]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const visibleError = validationError || (submitted ? auth.error : '');
  useEffect(() => {
    if (visibleError) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [visibleError]);
  async function submit() {
    if (busy) return;
    setSubmitted(false);
    setValidationError('');
    if (!auth.user) {
      if (mode === 'register' && (name.trim().length < 2 || name.trim().length > 80)) {
        setValidationError('Enter your name using 2 to 80 characters.'); return;
      }
      if (email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setValidationError('Enter a valid email address, such as name@example.com.'); return;
      }
      if (!password || password.length > 128 || (mode === 'register' && password.length < 12)) {
        setValidationError(mode === 'register' ? 'Your password must contain 12 to 128 characters. Please add more characters and try again.' : 'Enter your password (up to 128 characters).'); return;
      }
    }
    setSubmitted(true);
    setBusy(true);
    try { await auth.submit(auth.user ? 'logout' : mode, { name, email, password }); setPassword(''); }
    catch { /* The shared account state displays the error. */ }
    finally { setBusy(false); }
  }
  return <section className="fc-account">
    <div className="fc-account-mark"><Leaf size={28} /></div>
    <span className="fc-account-eyebrow">YOUR LITTLE CORNER OF FRESH</span>
    <h2 id="dialog-title">{auth.user ? `Hello, ${auth.user.name}.` : mode === 'register' ? 'Good things start here.' : 'Fresh to see you again.'}</h2>
    {visibleError && <p ref={errorRef} tabIndex={-1} className="fc-error" role="alert" style={{ padding: "12px", background: "#fff1ec", border: "1px solid #d78770", borderRadius: "10px" }}>{visibleError}</p>}
    {auth.loading ? <p role="status">Checking your account…</p> : auth.user ? <>
      <p>Your details, deliveries and account security in one place.</p>
      <div className="fc-account-details"><small>ACCOUNT TYPE</small><span>{auth.user.accountType === "farmer" ? "Farmer account" : auth.user.accountType === "bulk_buyer" ? "Bulk-buyer account" : "Consumer account"}</span></div>
      <div className="fc-account-shopping"><button className="fc-primary" onClick={onOrders}>My purchases</button><button className="fc-profile-outline" onClick={onSaved}>Saved products</button><button className="fc-profile-outline" onClick={onHelp}>Order help & requests</button></div><CustomerProfile auth={auth}/><AccountSecurity /><div className="fc-workspace-links"><a href="/farmer">Farmer workspace ↗</a><a href="/delivery">Delivery partner workspace ↗</a>{navigator.userAgent.includes('FarmconnectAndroid')&&<a href="farmconnect://settings">App connection & settings</a>}</div><button className="fc-account-switch" onClick={onApply}>Seller / business application and access</button>{auth.user.requestedAccountType === "farmer" && <button className="fc-primary" onClick={onFarmer}>Open farmer workspace</button>}{auth.user.accountType === "bulk_buyer" && <button className="fc-primary" onClick={onBulk}>Open business purchasing</button>}{canAdmin && <button className="fc-primary" onClick={onAdmin}>Manage store</button>}<button className="fc-account-switch" onClick={onCheckout}>Continue or retry checkout</button>
      <button className="fc-primary" disabled={busy} onClick={submit}>{busy ? 'Signing out…' : 'Sign out'}<LogOut size={18}/></button>
    </> : <>
      <p>{mode === 'register' ? 'Create a shopping account. Seller and business access require a separate application and approval.' : 'Sign in to your grower-to-basket market.'}</p>
      <GoogleSignIn /><form noValidate aria-busy={busy} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <fieldset disabled={busy}>
          {mode === 'register' && <label>Your name<input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>}
          <label>Email address<input type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 12 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} aria-describedby={mode === 'register' ? 'password-help' : undefined} /></label>
          {mode === 'register' && <small id="password-help">Use 12–128 characters. A memorable phrase works well.</small>}
          <button className="fc-primary" type="submit">{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}<ArrowRight size={18}/></button>
        </fieldset>
      </form>
      <button className="fc-account-switch" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setPassword(''); setValidationError(''); setSubmitted(false); }}>{mode === 'login' ? 'New here? Create an account' : 'Already a member? Sign in'}</button>
    </>}
    {!auth.user&&!auth.loading&&<nav className="fc-workspace-links" aria-label="Partner sign in"><a href="/farmer">Farmer sign in ↗</a><a href="/delivery">Delivery partner sign in ↗</a></nav>}
    {busy && <p role="status">Contacting the server. Please wait…</p>}
  </section>;
}




