import ProductReviews from './ProductReviews';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Heart, Leaf, MapPin, Minus, Plus, Search, SlidersHorizontal, Sprout, Star, X } from 'lucide-react';
import { amountLabel, money, quantityStep, unitPrice, type Product } from '../data/products';

export type MarketTab = 'home' | 'browse';
type Props = {
  products: Product[]; cart: Record<string,number>; tab: MarketTab; onTab:(tab:MarketTab)=>void;
  pincode:string; onLocation:()=>void; onAccount:()=>void; onProduct:(id:string)=>void;
  onChange:(id:string,quantity:number)=>void; savedIds:string[]; saving:boolean; onSave:(product:Product)=>void; error:string;
};
function ProduceImage({product}:{product:Product}) {
  const [failed,setFailed]=useState(false);
  return failed?<span className="fm-image-fallback"><Leaf/><span>{product.name}</span></span>:<img src={product.image} alt={product.name} loading="lazy" onError={()=>setFailed(true)}/>;
}
function MobileCard({product,quantity,saved,saving,onSave,onProduct,onChange}:{product:Product;quantity:number;saved:boolean;saving:boolean;onSave:()=>void;onProduct:()=>void;onChange:(n:number)=>void}) {
  const step=quantityStep(product),available=product.stock>=(product.saleMode==='weight'?50:1),weight=product.saleMode==='weight';
  return <article className="fm-card" data-added={quantity>0}>
    <button className="fm-card-photo" onClick={onProduct} aria-label={'View '+product.name}><ProduceImage product={product}/>{!available&&<span className="fm-sold">Sold out</span>}</button>
    <button className="fm-heart" disabled={saving} aria-label={(saved?'Unsave ':'Save ')+product.name} aria-pressed={saved} onClick={onSave}><Heart size={17} fill={saved?'currentColor':'none'}/></button>
    <div className="fm-card-body"><p className="fm-grower"><Sprout size={12}/>{product.farmName}</p><button className="fm-card-name" onClick={onProduct}>{product.name}</button>
      <span className="fm-card-unit">{weight?'Choose your weight':product.unit}{Boolean(product.reviewCount)&&<span><Star size={11} fill="currentColor"/> {product.rating}</span>}</span>
      <div className="fm-card-buy"><div><strong>{money(unitPrice(product,Math.max(quantity,step)))}</strong><small>/ {weight?'kg':'pack'}</small></div>
        {quantity? <div className="fm-mini-counter" aria-label={product.name+' basket quantity'}><button onClick={()=>onChange(-Math.min(step,quantity))} aria-label={'Reduce '+product.name}><Minus size={14}/></button><button className="fm-in-basket" onClick={onProduct} aria-label={'Change weight of '+product.name}>{amountLabel(quantity,product.saleMode,product.unit)}</button><button disabled={quantity+step>product.stock} onClick={()=>onChange(step)} aria-label={'Add more '+product.name}><Plus size={14}/></button></div>:<button className="fm-add" disabled={!available} onClick={onProduct}>{available?'Add':'Sold out'}{available&&<Plus size={14}/>}</button>}
      </div>
      {product.bulkPricePaise<product.pricePaise&&<small className="fm-bulk-rate">{money(product.bulkPricePaise)}/{weight?'kg':'pack'} on {amountLabel(product.bulkMin,product.saleMode,product.unit)}+</small>}
    </div>
  </article>;
}
export default function MobileMarket(p:Props) {
  const [query,setQuery]=useState(''),[category,setCategory]=useState('All produce'),[sort,setSort]=useState('featured'),[stockOnly,setStockOnly]=useState(false),[bulkOnly,setBulkOnly]=useState(false),[filters,setFilters]=useState(false);
  useEffect(()=>{if(p.tab==='home'){setQuery('');setCategory('All produce');setStockOnly(false);setBulkOnly(false);}},[p.tab]);
  const categoryNames=['All produce',...new Set(p.products.map(product=>product.category))];
  const filtering=Boolean(query.trim())||p.tab==='browse';
  const shown=p.products.filter(product=>(!filtering||category==='All produce'||product.category===category)&&`${product.name} ${product.farmName} ${product.variety??''}`.toLowerCase().includes(query.trim().toLowerCase())&&(!stockOnly||product.stock>=(product.saleMode==='weight'?50:1))&&(!bulkOnly||product.bulkPricePaise<product.pricePaise)).sort((a,b)=>sort==='low'?a.pricePaise-b.pricePaise:sort==='high'?b.pricePaise-a.pricePaise:0);
  const featured=p.products.find(product=>product.stock>0)??p.products[0];
  function selectCategory(name:string){setCategory(name);p.onTab('browse');}
  return <div className="fm-market">
    <header className="fm-top"><div className="fm-topline"><button className="fm-location" onClick={p.onLocation}><span><MapPin size={13}/> DELIVER TO</span><strong>{p.pincode||'Choose your area'}<ChevronDown size={15}/></strong></button><button className="fm-logo" onClick={p.onAccount} aria-label="Open account"><img src="/farmconnect.svg" alt=""/><span>Farmconnect<small>DIRECT FROM THE GROWER</small></span></button></div>
      <form className="fm-search" role="search" onSubmit={e=>{e.preventDefault();p.onTab('browse');}}><Search size={20}/><input type="search" aria-label="Search fresh produce" placeholder="Search tomatoes, mangoes, farmers…" value={query} onChange={e=>{setQuery(e.target.value);setCategory('All produce');if(e.target.value&&p.tab==='home')p.onTab('browse');}}/>{query&&<button type="button" onClick={()=>setQuery('')} aria-label="Clear search"><X size={18}/></button>}</form>
    </header>
    {!filtering&&featured&&<>
      <section className="fm-hero"><div><span className="fm-eyebrow"><span/> A LITTLE CLOSER TO THE FARM</span><h1>Good food.<br/><em>Great beginnings.</em></h1><p>Meet the growers behind your everyday favourites.</p><button onClick={()=>selectCategory('All produce')}>Explore the harvest <ArrowRight size={16}/></button></div><button className="fm-hero-photo" onClick={()=>p.onProduct(featured.id)} aria-label={'Explore '+featured.name}><ProduceImage product={featured}/><span><Sprout size={14}/> From {featured.farmName}</span></button></section>
      <section className="fm-categories" aria-label="Shop by category"><div className="fm-section-title"><h2>Fresh in every way</h2><button onClick={()=>selectCategory('All produce')}>View all <ArrowRight size={14}/></button></div><div className="fm-category-grid">{categoryNames.filter(n=>n!=='All produce').map(name=>{const product=p.products.find(product=>product.category===name)!;return <button key={name} onClick={()=>selectCategory(name)}><span><ProduceImage product={product}/></span><strong>{name}</strong></button>;})}</div></section>
    </>}
    <section className="fm-discovery" aria-label="Fresh produce"><div className="fm-section-title"><div><span className="fm-eyebrow">{filtering?'FIND YOUR FRESH':'PICKED FOR YOUR TABLE'}</span><h2>{query?'Search results':filtering?category==='All produce'?'Browse the harvest':category:'Your daily good'}</h2></div><button className="fm-filter-button" aria-expanded={filters} onClick={()=>setFilters(!filters)} aria-label="Sort and filter products"><SlidersHorizontal size={18}/>{(stockOnly||bulkOnly||sort!=='featured')&&<i/>}</button></div>
      {filtering&&<div className="fm-category-tabs" aria-label="Product categories">{categoryNames.map(name=><button key={name} aria-pressed={category===name} onClick={()=>setCategory(name)}>{name==='All produce'?'All':name}</button>)}</div>}
      {filters&&<div className="fm-filters"><label>Sort products<select value={sort} onChange={e=>setSort(e.target.value)}><option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option></select></label><label><input type="checkbox" checked={stockOnly} onChange={e=>setStockOnly(e.target.checked)}/> In stock only</label><label><input type="checkbox" checked={bulkOnly} onChange={e=>setBulkOnly(e.target.checked)}/> Bulk savings</label></div>}
      <p className="fm-result-count" aria-live="polite">{shown.length} {shown.length===1?'listing':'listings'}{query?` for “${query}”`:' from our growers'}</p>{p.error&&<p role="alert" className="fc-order-error">{p.error}</p>}
      {shown.length?<div className="fm-product-grid">{shown.map(product=><MobileCard key={product.id} product={product} quantity={p.cart[product.id]??0} saved={p.savedIds.includes(product.id)} saving={p.saving} onSave={()=>p.onSave(product)} onProduct={()=>p.onProduct(product.id)} onChange={n=>p.onChange(product.id,n)}/>)}</div>:<div className="fm-empty"><Search size={32}/><h3>Let’s find something fresh.</h3><p>No produce matches these filters.</p><button onClick={()=>{setQuery('');setCategory('All produce');setStockOnly(false);setBulkOnly(false);}}>Clear filters</button></div>}
    </section>
    <div className="fm-promise"><Leaf size={24}/><h2>Good food.<br/>Closer connections.</h2><p>Every listing has a grower.<br/>Every order supports their business.</p></div>
  </div>;
}

export function ProductDetail({product,quantity,saved,saving,onSave,onChange,onBasket}:{product:Product;quantity:number;saved:boolean;saving:boolean;onSave:()=>void;onChange:(quantity:number)=>void;onBasket:()=>void}) {
  const weight=product.saleMode==='weight',minimum=weight?50:1;
  const [selected,setSelected]=useState(Math.min(quantityStep(product),Math.floor(product.stock/minimum)*minimum)||minimum),[notice,setNotice]=useState('');
  const choices=[50,100,250,500,1000,2000,5000,10000].filter(n=>n<=product.stock);
  const rate=unitPrice(product,Math.max(selected,quantity+selected)),price=Math.round(weight?rate*selected/1000:rate*selected),canAdd=selected>=minimum&&selected+quantity<=product.stock;
  return <section className="fm-detail"><div className="fm-detail-photo"><ProduceImage product={product}/><button className="fm-heart" aria-pressed={saved} disabled={saving} aria-label={(saved?'Unsave ':'Save ')+product.name} onClick={onSave}><Heart size={22} fill={saved?'currentColor':'none'}/></button></div>
    <div className="fm-detail-copy"><span className="fm-eyebrow">{product.category}</span><h2 id="dialog-title">{product.name}</h2><p className="fm-detail-farm"><Sprout size={18}/>{product.farmName}{product.farmCity&&<span> · {product.farmCity}</span>}</p>
      <div className="fm-detail-price"><strong>{money(product.pricePaise)}</strong><span>/ {weight?'kg':'pack'}</span><span className="fm-stock-label">{product.stock>=minimum?<><Check size={14}/> In stock</>:'Currently sold out'}</span></div>
      {Boolean(product.reviewCount)&&<p><Star size={14} fill="currentColor"/> {product.rating} · {product.reviewCount} verified-purchase reviews</p>}
      <div className="fm-select-weight"><h3>{weight?'How much would you like?':'Choose your quantity'}</h3><p>{weight?'One harvest. Any weight you need.':'Sold in '+product.unit+' packs.'}</p>{weight?<div className="fm-weight-options">{choices.map(n=><button key={n} aria-pressed={selected===n} onClick={()=>{setSelected(n);setNotice('');}}>{amountLabel(n,'weight')}</button>)}</div>:<div className="fm-pack-quantity"><button disabled={selected<=1} onClick={()=>setSelected(n=>Math.max(1,n-1))} aria-label="Fewer packs"><Minus size={18}/></button><strong>{selected} packs</strong><button disabled={selected+quantity>=product.stock} onClick={()=>setSelected(n=>n+1)} aria-label="More packs"><Plus size={18}/></button></div>}
        {product.stock>=minimum&&<p className="fm-selected-price">{amountLabel(selected,product.saleMode,product.unit)} <strong>{money(price)}</strong>{rate<product.pricePaise&&<small>Bulk rate applied to your basket</small>}</p>}
        {quantity>0&&<p className="fm-already"><Check size={14}/>{amountLabel(quantity,product.saleMode,product.unit)} already in your basket <button onClick={onBasket}>Edit basket</button></p>}
      </div>
      {product.bulkPricePaise<product.pricePaise&&<div className="fm-bulk-banner"><Sprout size={24}/><div><strong>Bigger basket, better value.</strong><p>{money(product.bulkPricePaise)} / {weight?'kg':'pack'} when you buy {amountLabel(product.bulkMin,product.saleMode,product.unit)} or more.</p></div></div>}
      <div className="fm-produce-info"><h3>From the grower</h3><p>{product.qualityNotes||'Sold directly by '+product.farmName+'. Contact support from your order if you need help with the produce.'}</p>{product.variety&&<p><strong>Variety</strong>{product.variety}</p>}{product.harvestDate&&<p><strong>Harvest date</strong>{new Date(product.harvestDate+'T00:00:00').toLocaleDateString('en-IN')}</p>}{product.image.startsWith('/produce/')&&<small>Reference photo. Actual produce can vary in colour, shape and size.</small>}{product.image.startsWith('/produce/photos/')&&<a href={'/produce/credits.html#'+product.image.split('/').pop()?.split('.')[0]} target="_blank" rel="noreferrer">Photograph credit</a>}<ProductReviews productId={product.id}/></div>
    </div><footer className="fm-detail-action">{notice&&<p role="status"><Check size={15}/>{notice}</p>}<div><span><strong>{money(product.pricePaise)}</strong> / {weight?'kg':'pack'}</span>{notice?<button className="fc-primary" onClick={onBasket}>View basket <ArrowRight size={18}/></button>:<button className="fc-primary" disabled={!canAdd||price<1} onClick={()=>{onChange(selected);setNotice(amountLabel(selected,product.saleMode,product.unit)+' added to your basket');}}>{product.stock<minimum?'Sold out':!canAdd?'Stock limit reached':'Add to basket'}<Plus size={18}/></button>}</div></footer>
  </section>;
}
