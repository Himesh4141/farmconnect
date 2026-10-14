import ProductReviews from './ProductReviews';
import { useEffect, useRef, useState } from 'react';
import { Heart, Check, ChevronDown, Leaf, Minus, Plus, Sprout } from 'lucide-react';
import { amountLabel, money, unitPrice, type Product } from '../data/products';

type Props = { product: Product; quantity: number; index?: number; saved?:boolean; saving?:boolean; onSave?:()=>void; onOpen?:()=>void; onChange: (id: string, change: number) => void };
const weights = [250, 500, 1000];
export default function ProductCard({ product, quantity, index = 0, onChange, saved=false, saving=false, onSave, onOpen }: Props) {
  const weight = product.saleMode === 'weight';
  const [selected, setSelected] = useState(250);
  const [moreWeights, setMoreWeights] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const card = useRef<HTMLElement>(null);
  const choices = moreWeights ? [50, 100, 250, 500, 1000, 2000, 5000] : weights;
  const increment = weight ? selected : 1;
  const available = product.stock >= (weight ? 50 : 1);
  const rate = unitPrice(product, Math.max(quantity, increment));
  const price = weight ? Math.round(rate * increment / 1000) : rate;
  const discounted = product.bulkPricePaise < product.pricePaise;
  useEffect(() => {
    if (!card.current || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { threshold: 0.05 });
    observer.observe(card.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { setImageFailed(false); }, [product.image]);
  return <article ref={card} className="fc-produce-card" data-visible={visible} data-in-basket={quantity > 0} style={{ animationDelay: `${Math.min(index, 5) * 40}ms` }}>
    <div className="fc-produce-photo">
      {onOpen&&<button className="fc-open-product" onClick={onOpen} aria-label={'View '+product.name}/> }
      {imageFailed ? <div className="fc-produce-fallback"><Leaf size={40} /><span>{product.name}</span></div> : <img src={product.image} alt={product.name} loading="lazy" decoding="async" onError={() => setImageFailed(true)} />}
      <span className="fc-produce-tag">{product.category}</span>
      {quantity > 0 && <span className="fc-produce-added"><Check size={12} /> In basket</span>}
    </div>
    <div className="fc-produce-content">
      <p className="fc-produce-grower"><Sprout size={13} /><span>{product.farmName}</span></p>
      <div className="fc-product-heading"><h3>{product.name}</h3>{onSave&&<button className="fc-save-product" disabled={saving} aria-pressed={saved} aria-label={(saved?"Unsave ":"Save ")+product.name} onClick={onSave}><Heart size={19} fill={saved?"currentColor":"none"}/></button>}</div>
      {Boolean(product.reviewCount)&&<p className="fc-product-rating">★ {product.rating} · {product.reviewCount} verified reviews</p>}
      <div className="fc-produce-meta"><span className={available ? 'is-available' : ''}>{available ? 'Available' : 'Sold out'}</span><span>{weight ? `${money(product.pricePaise)} / kg` : product.unit}</span></div>
      {weight ? <div className="fc-produce-weights" role="group" aria-label={`Choose weight for ${product.name}`}>
        {choices.map(grams => <button key={grams} type="button" aria-pressed={selected === grams} onClick={() => setSelected(grams)} disabled={grams > product.stock}>{amountLabel(grams, 'weight')}</button>)}
        <button type="button" className="fc-produce-more" aria-expanded={moreWeights} aria-label={moreWeights ? 'Show fewer weights' : 'More weights'} onClick={() => { setMoreWeights(!moreWeights); if (moreWeights && !weights.includes(selected)) setSelected(250); }}>{moreWeights ? 'Less' : 'More'}<ChevronDown size={12} /></button>
      </div> : <div className="fc-produce-pack">{product.unit} · one pack</div>}
      <div className="fc-produce-purchase">
        <div className="fc-produce-cost"><strong key={rate}>{money(rate)}</strong><span>/ {weight ? 'kg' : 'pack'}</span></div>
        {quantity === 0 ? <button className="fc-produce-add" type="button" disabled={product.stock < increment || price < 1} onClick={() => onChange(product.id, increment)} aria-label={`Add ${weight ? amountLabel(increment, 'weight') : 'one pack'} of ${product.name}`}><Plus size={16} />{available ? 'Add' : 'Sold out'}</button> : <div className="fc-produce-counter" aria-label={`${product.name} basket quantity`}>
          <button type="button" onClick={() => onChange(product.id, -Math.min(quantity, increment))} aria-label={`Remove ${weight ? amountLabel(Math.min(quantity, increment), 'weight') : 'one pack'} of ${product.name}`}><Minus size={15} /></button>
          <span key={quantity} aria-live="polite">{weight ? amountLabel(quantity, 'weight') : quantity}</span>
          <button type="button" disabled={quantity + increment > Math.min(product.stock, weight ? 100000000 : 10000)} onClick={() => onChange(product.id, increment)} aria-label={`Add another ${weight ? amountLabel(increment, 'weight') : 'pack'} of ${product.name}`}><Plus size={15} /></button>
        </div>}
      </div>
      {quantity > 0 && weight && <p className="fc-produce-step">− / + changes your basket by {amountLabel(increment, 'weight')}</p>}
      {discounted && <p className="fc-produce-bulk">{quantity >= product.bulkMin ? 'Bulk price applied' : `${money(product.bulkPricePaise)} / ${weight ? 'kg' : 'pack'} on ${weight ? amountLabel(product.bulkMin, 'weight') : product.bulkMin + ' packs'}+`}</p>}
      <details className="fc-produce-details"><summary>About this produce<ChevronDown size={13} /></summary><div>
        {product.variety && <p><b>Variety:</b> {product.variety}</p>}{product.qualityNotes && <p>{product.qualityNotes}</p>}{product.farmCity && <p><b>Grown in:</b> {product.farmCity}</p>}{product.harvestDate && <p><b>Harvested:</b> {new Date(product.harvestDate + 'T00:00:00').toLocaleDateString('en-IN')}</p>}
        <p>Sold directly by {product.farmName}.</p>{product.image.startsWith('/produce/') && <p>Reference photo; actual produce may vary. {product.image.startsWith('/produce/photos/') && <a href={'/produce/credits.html#' + product.image.split('/').pop()?.split('.')[0]} target="_blank" rel="noreferrer">Photo credit</a>}</p>}
        <ProductReviews productId={product.id}/>
      </div></details>
    </div>
  </article>;
}

