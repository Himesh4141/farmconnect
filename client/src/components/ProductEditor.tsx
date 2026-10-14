import { uploadProductPhoto } from '../lib/photoUpload';
import { useState } from 'react';
import { ArrowLeft, Check, Leaf, MapPin, Search, Sprout } from 'lucide-react';
import { producePresets, type ProducePreset } from '../data/producePresets';
import { money } from '../data/products';
import { marketplaceRequest, type FarmerProduct } from '../lib/marketplace';

type Props = { product: FarmerProduct | null; onSaved: () => void; onBack: () => void; canPublish: boolean; pickupLabel?: string };
const packs = ['100 g', '250 g', '500 g', '1 kg', '2 kg', '5 kg', '1 bunch', '1 piece', '6 pieces', '12 pieces'];
export default function ProductEditor({ product, onSaved, onBack, canPublish, pickupLabel }: Props) {
  const [step, setStep] = useState<'pick' | 'details'>(product ? 'details' : 'pick');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All produce');
  const [visibleCount, setVisibleCount] = useState(24);
  const [weight,setWeight]=useState(product ? product.saleMode==='weight' : true);
  const [presetId,setPresetId]=useState(product?.presetId || producePresets.find(p=>p.image===product?.image)?.id || '');
  const [values, setValues] = useState({
    name: product?.name ?? '', category: product?.category ?? 'Vegetables', unit: product?.unit ?? '1 kg',
    price: product ? String(product.pricePaise / 100) : '', stock: product ? String(product.stock/(product.saleMode==='weight'?1000:1)) : '',
    bulk: product ? String(product.bulkPricePaise / 100) : '', minimum: String(product ? product.bulkMin/(product.saleMode==='weight'?1000:1) : 10),
    image: product?.image === '/farmconnect.svg' ? '' : product?.image ?? '', credit: product?.photoCredit ?? '',
    variety: product?.variety ?? '', qualityNotes: product?.qualityNotes ?? '', harvestDate: product?.harvestDate ?? '',
    active: canPublish && product?.active === 1,
  });
  const [bulkEnabled, setBulkEnabled] = useState(Boolean(product && product.bulkPricePaise < product.pricePaise));
  const [customPack, setCustomPack] = useState(Boolean(product && !packs.includes(product.unit)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ownPhoto, setOwnPhoto] = useState(Boolean(product?.image.startsWith('https://') || product?.image.startsWith('/api/photos/')));
  const [uploading, setUploading] = useState(false);
  const [photoNotice, setPhotoNotice] = useState('');
  async function upload(file?: File) {
    if(!file) return; setUploading(true); setError(''); setPhotoNotice('');
    try { const image=await uploadProductPhoto(file); setValues(previous=>({...previous,image,credit:'Farmer-provided photo'})); setPhotoNotice('Photo uploaded. Save your listing to apply it.'); }
    catch(failure){setError(failure instanceof Error ? failure.message : 'Upload failed. Try again.');}
    finally{setUploading(false);}
  }
  const preset = producePresets.find(item => item.image === values.image);
  const matches = producePresets.filter(item => (category === 'All produce' || item.category === category) && `${item.name} ${item.keywords}`.toLowerCase().includes(query.trim().toLowerCase()));
  const today = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
  function choose(item?: ProducePreset) {
    setPresetId(item?.id??'');
    setValues(previous => ({ ...previous, name: item?.name ?? '', category: item?.category ?? 'Vegetables', unit: item?.unit ?? '1 kg', image: item?.image ?? '', credit: item?.photoCredit ?? '' }));
    setCustomPack(false); setOwnPhoto(false); setError(''); setStep('details');
  }
  async function save() {
    if (busy || uploading) return;
    setError('');
    if (!/^\d+(\.\d{1,2})?$/.test(values.price) || Number(values.price) <= 0 || !(weight?/^\d+(\.\d{1,3})?$/:/^\d+$/).test(values.stock)) {
      setError('Enter a positive price and valid stock (kg supports up to 3 decimal places).'); return;
    }
    if (bulkEnabled && (!/^\d+(\.\d{1,2})?$/.test(values.bulk) || Number(values.bulk) <= 0 || Number(values.bulk) > Number(values.price) || !(weight?/^\d+(\.\d{1,3})?$/:/^\d+$/).test(values.minimum) || Number(values.minimum) < (weight?0.05:2) || (weight && Math.round(Number(values.minimum)*1000)%50!==0))) {
      setError('Bulk price must be greater than zero and no higher than retail price. Use a bulk minimum of 0.05 kg or more in 50 g steps, or at least 2 packs.'); return;
    }
    setBusy(true);
    try {
      await marketplaceRequest('/products' + (product ? '/' + product.id : ''), {
        name: values.name, category: values.category, unit: weight?'kg':values.unit, saleMode:weight?'weight':'pack',presetId,
        pricePaise: Math.round(Number(values.price) * 100), ...(!product?{stock:Math.round(Number(values.stock)*(weight?1000:1))}:{}),
        bulkPricePaise: Math.round(Number(bulkEnabled ? values.bulk : values.price) * 100), bulkMin: Math.round((bulkEnabled ? Number(values.minimum) : 10)*(weight?1000:1)),
        image: values.image, photoCredit: values.credit, variety: values.variety, qualityNotes: values.qualityNotes, harvestDate: values.harvestDate,
        active: values.active ? 1 : 0, revision: product?.revision,
      });
      onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save. Please try again.'); }
    finally { setBusy(false); }
  }
  return <section className="fp-listing-flow">
    <div className="fp-flow-top"><button type="button" className="fp-back" disabled={busy || uploading} onClick={onBack}><ArrowLeft size={16} /> My products</button><span><b>{step === 'pick' ? '01' : '02'}</b> / 02 · {step === 'pick' ? 'Choose produce' : 'Selling details'}</span></div>
    {step === 'pick' ? <>
      <div className="fp-picker-intro"><span className="fc-account-eyebrow">FROM YOUR FIELD TO THEIR TABLE</span><h2>What did you grow?</h2><p>Choose a picture. We’ll fill in the name, category and a suggested pack size.</p></div>
      <label className="fp-produce-search"><Search size={19} /><input type="search" aria-label="Search produce" placeholder="Try tomato, palak, bhindi…" value={query} onChange={e => { setQuery(e.target.value); setVisibleCount(24); }} /></label>
      <div className="fc-admin-tabs" aria-label="Produce categories">{['All produce', 'Vegetables', 'Leafy greens', 'Fruits'].map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => { setCategory(value); setVisibleCount(24); }}>{value} ({value === 'All produce' ? producePresets.length : producePresets.filter(item => item.category === value).length})</button>)}</div>
      <p className="fp-picker-caption">{producePresets.length} produce choices · Real reference photos, not photos of your specific harvest</p>
      <div className="fp-produce-grid">{matches.slice(0, visibleCount).map(item => <button type="button" key={item.id} className="fp-produce-choice" onClick={() => choose(item)}><img src={item.image} alt="" loading="lazy" decoding="async" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = '/farmconnect.svg'; }} /><span>{item.name}</span><small>{item.category}</small><span className="fp-choice-add" aria-hidden="true">+</span></button>)}<button type="button" className="fp-produce-choice fp-custom-produce" onClick={() => choose()}><span className="fp-custom-art"><Sprout size={48} strokeWidth={1.2} /></span><span>Something else</span><small>Add your own produce</small><span className="fp-choice-add" aria-hidden="true">+</span></button></div>
      {matches.length > visibleCount && <button type="button" className="fp-show-more" onClick={() => setVisibleCount(count => count + 24)}>Show more produce ({matches.length - visibleCount} remaining)</button>}
      <p className="fp-photo-credit"><a href="/produce/credits.html" target="_blank" rel="noreferrer">Photo sources and licences</a></p>
      {!matches.length && <p role="status">No matching preset. Choose Something else to create your listing.</p>}
    </> : <>
      <div className="fp-selected-produce"><img src={values.image || '/farmconnect.svg'} alt="" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = '/farmconnect.svg'; }} /><div><span className="fc-account-eyebrow">{product ? 'EDIT YOUR LISTING' : 'YOUR PRODUCE, READY TO LIST'}</span><h2>{values.name || 'Your produce'}</h2><p>{preset ? 'Representative produce photo included' : ownPhoto ? 'Your product photo' : 'Add a name and the selling details below'}</p>{!product && <button type="button" className="fp-back" disabled={busy || uploading} onClick={() => setStep('pick')}>Choose a different produce</button>}</div></div>
      {error && <p className="fc-order-error" role="alert">{error}</p>}
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <fieldset disabled={busy || uploading}>
          <div className="fp-detail-block"><h3><span>1</span> Describe your produce</h3><div className="fc-admin-fields"><label>Product name<input required minLength={2} maxLength={160} value={values.name} onChange={e => setValues({ ...values, name: e.target.value })} /></label><label>Variety (optional)<input maxLength={80} placeholder="e.g. Hybrid, cherry, desi" value={values.variety} onChange={e => setValues({ ...values, variety: e.target.value })} /></label></div>
            <div className="fc-admin-fields"><label>Category{presetId?<input readOnly value={values.category} aria-label="Category chosen from produce"/>:<select value={values.category} onChange={e => setValues({ ...values, category: e.target.value })}>{['Vegetables', 'Leafy greens', 'Fruits'].map(value => <option key={value}>{value}</option>)}</select>}</label>{!weight&&<label>One pack contains<select value={customPack ? 'custom' : values.unit} onChange={e => { setCustomPack(e.target.value === 'custom'); setValues({ ...values, unit: e.target.value === 'custom' ? '' : e.target.value }); }}>{packs.map(value => <option key={value}>{value}</option>)}<option value="custom">Custom pack size</option></select></label>}</div>
            {!weight && customPack && <label>Describe one pack<input required maxLength={40} placeholder="e.g. 15 kg crate" value={values.unit} onChange={e => setValues({ ...values, unit: e.target.value })} /></label>}
          </div>
          {!product&&<label>Selling method<select value={weight?'weight':'pack'} onChange={e=>{setWeight(e.target.value==='weight');setValues({...values,stock:'',minimum:'10'});}}><option value="weight">By weight — price per kg, one shared stock</option><option value="pack">By piece / bunch / fixed pack</option></select></label>}{product&&!weight&&<p className="fc-order-note">Legacy pack listing. To switch to shared kg stock, archive this listing and create a new weight-based listing. Past orders remain unchanged.</p>}<div className="fp-detail-block"><h3><span>2</span> Set your price and stock</h3><div className="fc-admin-fields"><label>{weight?'Price per kg (₹)':'Price for one pack (₹)'}<input required inputMode="decimal" placeholder="e.g. 40" value={values.price} onChange={e => setValues({ ...values, price: e.target.value })} /></label><label>{weight?'Total available stock (kg)':'Available packs'}<input required readOnly={Boolean(product)} aria-readonly={Boolean(product)} inputMode={weight?'decimal':'numeric'} placeholder="e.g. 50" value={values.stock} onChange={e => setValues({ ...values, stock: e.target.value })} /></label></div><p className="fp-form-help">{product?'Stock is read-only here. Go back to My products → Manage stock to add or reduce quantity.':weight?'Enter your total harvest, e.g. 2000 for 2 tonnes. All customer weights use this one stock balance.':'Enter the number of packs available.'}</p>
            <label className="fc-admin-check"><input type="checkbox" checked={bulkEnabled} onChange={e => setBulkEnabled(e.target.checked)} /> Offer a bulk price for hotels, cafés and larger orders</label>
            {bulkEnabled && <div className="fc-admin-fields"><label>{weight?'Bulk price per kg (₹)':'Bulk price for one pack (₹)'}<input required inputMode="decimal" placeholder="e.g. 35" value={values.bulk} onChange={e => setValues({ ...values, bulk: e.target.value })} /></label><label>{weight?'Minimum order weight (kg)':'Minimum packs for bulk price'}<input required inputMode="numeric" value={values.minimum} onChange={e => setValues({ ...values, minimum: e.target.value })} /></label></div>}
          </div>
          <div className="fp-detail-block"><h3><span>3</span> Freshness and pickup</h3><label>Quality description (optional)<textarea maxLength={500} rows={3} placeholder="e.g. Firm and ripe, mixed sizes, sorted by hand. Describe this batch honestly." value={values.qualityNotes} onChange={e => setValues({ ...values, qualityNotes: e.target.value })} /></label><small>Shown to buyers as your description. This is not an independently verified quality certificate.</small><label>Harvest date (optional)<input type="date" max={today} value={values.harvestDate} onChange={e => setValues({ ...values, harvestDate: e.target.value })} /></label><p className="fp-pickup"><MapPin size={18} /><span><strong>Pickup from your farm</strong><br />{pickupLabel || 'Complete your pickup location in My farm.'}<br /><small>Managed in My farm. Your street address stays private; buyers may see your city.</small></span></p></div>
          <details className="fp-detail-block fp-photo-options" open={ownPhoto}><summary onClick={e => { e.preventDefault(); setOwnPhoto(!ownPhoto); }}>Use my own photo (optional)</summary><label>Choose a photo from your phone or computer<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label><p role="status">{uploading ? 'Uploading your photo…' : photoNotice}</p><small>JPEG, PNG or WebP, up to 10 MB. Photos are resized automatically.</small><label>Or use a public HTTPS photo URL<input type="url" maxLength={1500} value={values.image.startsWith('https://') ? values.image : ''} placeholder="https://…" onChange={e => setValues({ ...values, image: e.target.value, credit: '' })} /></label><small>Use a photo you own or have permission to use. Uploaded photos are stored with your Farmconnect database.</small><label>Photo credit<input maxLength={200} value={values.credit} onChange={e => setValues({ ...values, credit: e.target.value })} /></label></details>
          {weight&&Number(values.price)>0&&<p className="fc-order-note">Automatic price examples: 250 g = {money(Math.round(Number(values.price)*25))} · 500 g = {money(Math.round(Number(values.price)*50))} · 1 kg = {money(Math.round(Number(values.price)*100))}. Final amounts rounded to the nearest paise.</p>}<div className="fp-listing-summary"><Leaf size={24} /><div><strong>{values.name || 'Your produce'}</strong><p>{weight?'1 kg':values.unit || 'Choose pack size'} · {Number(values.price) > 0 ? money(Math.round(Number(values.price) * 100)) : 'Set a price'} / {weight?'kg':'pack'} · {values.stock || '0'} {weight?'kg available':'packs'}</p></div><Check size={19} /></div>
          <label className="fc-admin-check"><input type="checkbox" checked={values.active} disabled={!canPublish} onChange={e => setValues({ ...values, active: e.target.checked })} /> Publish in marketplace</label>{!canPublish && <p className="fp-form-help">You can save this draft now. Publishing unlocks after farm approval.</p>}
          <button className="fc-primary" type="submit">{busy ? 'Saving your listing…' : values.active ? 'Save and publish' : 'Save draft'}</button>
        </fieldset>
      </form>
    </>}
  </section>;
}
