import MobileMarket,{ProductDetail} from './components/MobileMarket';
import ConnectionHelp from './components/ConnectionHelp';
import {useStoreNavigation,type Panel} from './lib/storeNavigation';
import {Home,Grid2X2,Heart,ClipboardList,ArrowLeft} from 'lucide-react';
import SavedProducts,{useSavedProducts} from './components/SavedProducts';
import HelpCenter from './components/HelpCenter';
import LocationAssist from './components/LocationAssist';
import { useRefreshTick } from './lib/useRefreshTick';
import AccessPanel from './components/AccessPanel';

import BulkPanel from './components/BulkPanel';
import AdminPanel from './components/AdminPanel';
import { CheckoutPanel, OrdersPanel, OrderReceipt } from './components/CheckoutPanel';
import type { Order } from './lib/orders';
import AccountPanel from './components/AccountPanel';
import { useAuth } from './lib/auth';
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Leaf,
  MapPin,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBag,
  UserRound,
  Store,
  Trash2,
  X
} from "lucide-react";
import ProductCard from "./components/ProductCard";
import { money, unitPrice, quantityStep, amountLabel, type Product } from "./data/products";
import { ApiError, getCatalog, getCartQuote, type Catalog, type CartItem, type CartQuote } from "./lib/api";
type Cart = Record<string, number>;

const CART_KEY = "farmconnect.cart.v1";
const LOCATION_KEY = "farmconnect.location.v1";
type QuoteState = {
  key: string;
  status: "loading" | "ready" | "error";
  data?: CartQuote;
  message?: string;
  stockChanged?: boolean;
};

function loadCart(products: Product[]): Cart {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CART_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      return {};
    const saved = value as Record<string, unknown>;
    const result: Cart = {};
    products.forEach((product) => {
      const quantity = saved[product.id];
      if (typeof quantity === "number" && Number.isFinite(quantity)) {
        const step=product.saleMode==='weight'?50:1;
        const safe = Math.floor(Math.min(product.stock,product.saleMode==='weight'?100000000:10000,Math.max(0,quantity))/step)*step;
        if (safe > 0)
          result[product.id] = safe;
      }
    });
    return result;
  }
  catch {
    return {};
  }
}
function loadLocation(pincodes: string[]) {
  try {
    const saved = localStorage.getItem(LOCATION_KEY) ?? "";
    return pincodes.includes(saved) ? saved : (pincodes[0] ?? "");
  }
  catch {
    return pincodes[0] ?? "";
  }
}
function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function goTo(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: reduceMotion() ? "instant" : "smooth", block: "start",
  });
}
export default function App() {
  const auth = useAuth();
  const saved = useSavedProducts(auth.user?.id);
  useEffect(() => { if (auth.user?.accountType === 'delivery') window.location.replace('/delivery'); }, [auth.user?.accountType]);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const [catalogError, setCatalogError] = useState("");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [cart, setCart] = useState<Cart>({});
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All produce");
  const [sort, setSort] = useState("featured");
  const navigation=useStoreNavigation(checkoutBusy);
  const {panel,setPanel,mobile}=navigation;
  const [authTarget,setAuthTarget]=useState<Panel>(null);
  const [closing, setClosing] = useState(false);
  const [pincode, setPincode] = useState("");
  const [draft, setDraft] = useState(pincode);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(()=>{if(auth.user&&authTarget){setPanel(authTarget,true);setAuthTarget(null);}},[auth.user,authTarget]);
  useEffect(()=>{if(panel!=='account')setAuthTarget(null);if(panel==='receipt'&&!receipt)setPanel('orders',true);},[panel,receipt]);
  useEffect(()=>{if(!auth.loading&&!auth.user&&panel&&['saved','help','checkout','orders','admin','business','access'].includes(panel)){setAuthTarget(panel);setPanel('account',true);}},[auth.loading,auth.user,panel]);
  const liveTick=useRefreshTick(!checkoutBusy);
  useEffect(()=>{if(!liveTick)return;const controller=new AbortController();getCatalog(controller.signal).then(data=>{if(!controller.signal.aborted)setCatalog(data);}).catch(()=>{});return()=>controller.abort();},[liveTick]);
  const products = catalog?.products ?? [];
  const categories = catalog?.categories ?? [];
  const pincodes = catalog?.deliveryPincodes ?? [];
  const catalogReady = catalogStatus === "ready";
  // A changed or empty catalogue must never crash the featured artwork.
  const tomato = products.find((product) => product.id === "tomatoes") ?? products[0];
  const spinach = products.find((product) => product.category === "Leafy greens") ?? tomato;
  const banana = products.find((product) => product.category === "Fruits") ?? tomato;

  useEffect(() => {
    const controller = new AbortController();
    setCatalogStatus("loading");
    setCatalogError("");

    getCatalog(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setCatalog(data);
      setCart(loadCart(data.products));
      setPincode(loadLocation(data.deliveryPincodes));
      setCategory((current) => data.categories.includes(current) ? current : "All produce");
      setCatalogStatus("ready");
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      setCatalogError(failure instanceof Error ? failure.message : "Unable to load the catalogue.");
      setCatalogStatus("error");
    });

    return () => controller.abort();
  }, [catalogAttempt]);

  useEffect(() => {
    // Wait for real products before replacing saved quantities in the browser.
    if (!catalogReady) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
      localStorage.setItem(LOCATION_KEY, pincode);
    }
    catch { /* The current visit still works without browser storage. */ }
  }, [cart, pincode, catalogReady]);
  useEffect(() => {
    const element = dialog.current;
    if (!element)
      return;
    if (!panel) {
      if (element.open)
        element.close();
      return;
    }
    if (!element.open)
      element.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [panel]);
  useEffect(() => () => {
    if (timer.current !== null)
      window.clearTimeout(timer.current);
  }, []);
  const rows = products.filter((product) => (cart[product.id] ?? 0) > 0);
  const count = rows.length;
  const itemsJson = JSON.stringify(rows.map((product) => ({
    productId: product.id,
    quantity: cart[product.id],
  })));
  const quoteKey = `${itemsJson}:${quoteAttempt}:${catalogAttempt}`;
  const currentQuoteState = quoteState?.key === quoteKey ? quoteState : null;
  const quote = catalogReady && currentQuoteState?.status === "ready" ? currentQuoteState.data : undefined;
  const quoteError = currentQuoteState?.status === "error" ? currentQuoteState : null;
  const totalLabel = count === 0 ? money(0) : quote ? money(quote.subtotalPaise) : quoteError ? "Price unavailable" : "Checking prices…";

  useEffect(() => {
    if (!catalogReady || itemsJson === "[]") return;
    const controller = new AbortController();
    setQuoteState({ key: quoteKey, status: "loading" });

    // Group rapid + / - clicks into one request and discard older responses.
    const debounce = window.setTimeout(() => {
      getCartQuote(JSON.parse(itemsJson) as CartItem[], controller.signal).then((data) => {
        if (!controller.signal.aborted) {
          setQuoteState({ key: quoteKey, status: "ready", data });
        }
      }).catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setQuoteState({
          key: quoteKey,
          status: "error",
          message: failure instanceof Error ? failure.message : "Unable to calculate your basket.",
          stockChanged: failure instanceof ApiError &&
            (failure.status === 409 || failure.code === "PRODUCT_UNAVAILABLE"),
        });
      });
    }, 200);

    return () => {
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [itemsJson, quoteKey, catalogReady]);
  const visibleProducts = products.filter((product) => {
    const matchesCategory = category === "All produce" || product.category === category;
    const text = `${product.name} ${product.farmName} ${product.category}`.toLowerCase();
    return matchesCategory && text.includes(query.trim().toLowerCase());
  }).sort((a, b) => sort === "low" ? a.pricePaise - b.pricePaise : sort === "high" ? b.pricePaise - a.pricePaise : 0);
  function changeQuantity(id: string, change: number) {
    if (!catalogReady) return;
    const product = products.find((item) => item.id === id);
    if (!product)
      return;
    setCart((current) => {
      const next = { ...current };
      const step=product.saleMode==='weight'?50:1;
      const quantity = Math.floor(Math.max(0, Math.min(product.stock,product.saleMode==='weight'?100000000:10000,(current[id] ?? 0) + change))/step)*step;
      if (quantity > 0)
        next[id] = quantity;
      else
        delete next[id];
      return next;
    });
  }
  async function addSavedProduct(id:string,quantity:number){
    const fresh=await getCatalog(AbortSignal.timeout(15000));setCatalog(fresh);
    const product=fresh.products.find(item=>item.id===id);
    if(!product||product.stock<quantity)throw Error('This produce is no longer available in that quantity. Refresh your saved products.');
    if((cart[id]??0)+quantity>product.stock)throw Error('Your basket already contains the available quantity. Open your basket to review it.');
    setCart(current=>({...current,[id]:Math.min(product.stock,(current[id]??0)+quantity)}));openPanel('basket');
  }
  async function repeatOrder(items:CartItem[]){const fresh=await getCatalog(AbortSignal.timeout(15000));setCatalog(fresh);setCart(Object.fromEntries(items.map(i=>[i.productId,i.quantity])));openPanel('basket');}
  function remove(id: string) {
    setCart((current) => { const next = { ...current }; delete next[id]; return next; });
  }
  function openPanel(next: Exclude<Panel, null>) {
    if (timer.current !== null)
      window.clearTimeout(timer.current);
    timer.current = null;
    setClosing(false);
    setDraft(pincode);
    setError("");
    setPanel(next,next==='receipt');
    if(dialog.current)dialog.current.scrollTop=0;
  }
  function closePanel() {
    if (checkoutBusy || closing || !panel)
      return;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      navigation.back();
      setClosing(false);
      timer.current = null;
    }, reduceMotion() ? 0 : 180);
  }
  function requestAccount(next:Exclude<Panel,null>){if(auth.user)openPanel(next);else{setAuthTarget(next);openPanel('account');}}
  const selectedProduct=products.find(product=>product.id===navigation.productId);
  function browse(next = "All produce") {
    setCategory(categories.includes(next) ? next : "All produce");
    setQuery("");
    goTo("market");
  }
  return (<div className="fc-app" data-mobile={mobile}>
    <aside
      className="fc-rail"
      aria-label="Store navigation"
    >
      <a
        href="#top"
        className="fc-rail-logo"
        aria-label="Farmconnect home"
      >
        <img
          src="/farmconnect.svg"
          alt=""
        />
      </a>
      <nav>
        <button
          type="button"
          onClick={() => browse()}
        >
          <Store />
          <span>Shop</span>
        </button>
        <button
          type="button"
          onClick={() => browse("Leafy greens")}
        >
          <Leaf />
          <span>Greens</span>
        </button>
        <button
          type="button"
          onClick={() => goTo("bulk")}
        >
          <Package />
          <span>Bulk</span>
        </button>
        <button
          type="button"
          onClick={() => openPanel("basket")}
          aria-haspopup="dialog"
        >
          <ShoppingBag />
          <span>Basket</span>
        </button>
      </nav>
      <span className="fc-rail-caption">GOOD FOOD. CLOSER CONNECTIONS.</span>
    </aside>

    <div
      className="fc-workspace"
      id="top"
    >
      <header className="fc-header">
        <a
          className="fc-brand"
          href="#top"
        >
          <img
            src="/farmconnect.svg"
            alt=""
          />
          <span>Farmconnect<small>THE GROWER-TO-BASKET MARKET</small>
          </span>
        </a>
        <form
          className="fc-search"
          role="search"
          onSubmit={(event) => { event.preventDefault(); goTo("market"); }}
        >
          <Search
            size={19}
            aria-hidden="true"
          />
          <input
            aria-label="Search produce or growers"
            placeholder="Find your next fresh favourite"
            type="search"
            value={query}
            disabled={!catalogReady}
            onChange={(event) => { setQuery(event.target.value); setCategory("All produce"); }}
          />
          {query && <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <X size={17} />
          </button>}
        </form>
        <button
          className="fc-location"
          type="button"
          onClick={() => openPanel("location")}
          aria-haspopup="dialog"
          disabled={!catalogReady || pincodes.length === 0}
        >
          <MapPin size={19} />
          <span>
            <small>Delivery area</small>
            <strong>
              {pincode || "Choose area"}
            </strong>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="fc-header-actions">
          <a className="fc-farmer-link" href="/farmer">Farmer portal ↗</a>
          <button className="fc-account-button" type="button" onClick={() => openPanel("account")} aria-haspopup="dialog" aria-label={auth.user ? "Open your account" : "Sign in or create account"}><UserRound size={20}/><span>{auth.user ? "My account" : "Sign in"}</span></button>
        <button
          className="fc-bag"
          type="button"
          onClick={() => openPanel("basket")}
          aria-label={`Open basket, ${count} products`}
          aria-haspopup="dialog"
        >
          <ShoppingBag size={21} />
          <span key={count}>
            {count}
          </span>
        </button>
        </div>
      </header>

      <main className="fc-main">
        {!mobile&&<div className="fc-intro">
          <span>
            <i /> A fresh way to shop, from the ground up.</span>
          <span>Farmers. Grower groups. You.</span>
        </div>}
        {catalogStatus === "loading" && <section className="fc-service-state" role="status" aria-live="polite">
          <span className="fc-loading-ring" aria-hidden="true" />
          <h1>Loading the harvest.</h1>
          <p>Getting the latest produce, pack prices, and availability.</p>
        </section>}
        {catalogStatus === "error" && <section className="fc-service-state" role="alert">
          <Store size={40} strokeWidth={1.4} />
          <h1>The market couldn’t load.</h1>
<p>{catalogError}</p><ConnectionHelp retry={()=>setCatalogAttempt(n=>n+1)}/>
          <button className="fc-primary" type="button" onClick={() => setCatalogAttempt((current) => current + 1)}>
            Try again <ArrowRight size={18} />
          </button>
        </section>}
        {catalogReady && products.length === 0 && <section className="fc-service-state">
          <Leaf size={42} strokeWidth={1.4} />
          <h1>A new harvest is on its way.</h1>
          <p>There are no products available right now. Please check again soon.</p>
          <button className="fc-primary" type="button" onClick={() => setCatalogAttempt((current) => current + 1)}>
            Refresh catalogue <ArrowRight size={18} />
          </button>
        </section>}
        {mobile&&catalogReady&&<MobileMarket products={products} cart={cart} tab={navigation.tab} onTab={navigation.setTab} pincode={pincode} onLocation={()=>openPanel('location')} onAccount={()=>openPanel('account')} onProduct={navigation.openProduct} onChange={changeQuantity} savedIds={saved.items.map(row=>row.id)} saving={saved.busy!==null} onSave={product=>auth.user?void saved.toggle(product):openPanel('account')} error={saved.error}/>}
        {!mobile&&catalogReady && tomato && spinach && banana && <>
        <section
          className="fc-hero"
          aria-labelledby="hero-title"
        >
          <div className="fc-hero-copy">
            <span className="fc-eyebrow">LESS DISTANCE. MORE CONNECTION.</span>
            <h1 id="hero-title">Fresh starts<br />
              <em>at the roots.</em>
            </h1>
            <p>Your everyday produce, with a grower behind every pick.</p>
            <div className="fc-hero-actions">
              <button
                className="fc-primary"
                type="button"
                onClick={() => browse()}
              >Shop the harvest <ArrowUpRight size={19} />
              </button>
              <button
                className="fc-text-button"
                type="button"
                onClick={() => goTo("bulk")}
              >Buying in bulk? <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="fc-harvest-art">
            <div
              className="fc-orbit"
              aria-hidden="true"
            />
            <img
              className="fc-photo fc-photo-main"
              src={tomato.image}
              alt={tomato.name}
              fetchPriority="high"
            />
            <img
              className="fc-photo fc-photo-leaf"
              src={spinach.image}
              alt={spinach.name}
            />
            <img
              className="fc-photo fc-photo-fruit"
              src={banana.image}
              alt={banana.name}
            />
            <div
              className="fc-stamp"
              aria-hidden="true"
            >
              <Leaf size={22} />
              <span>GOOD FROM<br />THE GROUND</span>
            </div>
            <button
              className="fc-harvest-pick"
              type="button"
              disabled={(cart[tomato.id] ?? 0)+quantityStep(tomato) > tomato.stock}
              onClick={() => changeQuantity(tomato.id, quantityStep(tomato))}
              aria-label={`Add ${tomato.name} to basket`}
            >
              <span>{tomato.name}<small>
                {money(unitPrice(tomato, Math.max(1, cart[tomato.id] ?? 0)))} / {tomato.unit}
              </small>
              </span>
              <Plus size={20} />
            </button>
          </div>
        </section>

        <section
          className="fc-category-row"
          aria-label="Produce categories"
        >
          {categories.map((name) => {
            const photo = name === "All produce" ? tomato : products.find((item) => item.category === name) ?? tomato;
            const amount = name === "All produce" ? products.length : products.filter((item) => item.category === name).length;
            return <button
              key={name}
              type="button"
              className={category === name ? "selected" : ""}
              aria-pressed={category === name}
              onClick={() => browse(name)}
            >
              <img
                src={photo.image}
                alt=""
              />
              <span>
                {name === "All produce" ? "The whole harvest" : name}
              </span>
              <small>
                {amount}
              </small>
            </button>;
          })}
        </section>

        <section
          id="market"
          className="fc-market"
          aria-labelledby="market-title"
        >
          <div className="fc-market-heading">
            <div>
              <span className="fc-eyebrow">FILL YOUR BASKET WITH GOOD</span>
              <h2 id="market-title">
                {category === "All produce" ? "The fresh edit" : category}
                <span>.</span>
              </h2>
              <p aria-live="polite">
                {visibleProducts.length} products{query.trim() ? ` matching “${query.trim()}”` : " · picked by you, packed with possibility"}
              </p>
            </div>
            <label className="fc-sort">
              <span className="sr-only">Sort products</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="featured">Featured picks</option>
                <option value="low">Price: low to high</option>
                <option value="high">Price: high to low</option>
              </select>
              <ChevronDown size={15} />
            </label>
          </div>
          {visibleProducts.length ? <div className="product-grid">
            {saved.error&&<p role="alert" className="fc-order-error">{saved.error}</p>}{visibleProducts.map((product, index) => <ProductCard saved={saved.items.some(row=>row.id===product.id)} saving={saved.busy!==null} onSave={()=>auth.user?void saved.toggle(product):openPanel("account")}
              key={product.id}
              product={product}
              index={index}
              quantity={cart[product.id] ?? 0}
              onChange={changeQuantity} onOpen={()=>navigation.openProduct(product.id)}
            />)}
          </div> : <div className="fc-empty">
            <Search size={35} />
            <h3>No matches this time.</h3>
            <p>Try a different product, grower, or category.</p>
            <button
              className="fc-primary"
              type="button"
              onClick={() => browse()}
            >Show all produce <ArrowRight size={17} />
            </button>
          </div>}
        </section>

        <section
          id="bulk"
          className="fc-bulk"
          aria-labelledby="bulk-title"
        >
          <div
            className="fc-bulk-symbol"
            aria-hidden="true"
          >
            <Package
              size={55}
              strokeWidth={1.3}
            />
            <span>MORE TO SHARE.</span>
          </div>
          <div>
            <span className="fc-eyebrow">FOR BIGGER TABLES & BIGGER PLANS</span>
            <h2 id="bulk-title">A bigger basket.<br />
              <em>A better pack price.</em>
            </h2>
            <p>For homes, cafés, hostels, and more. Reach a product’s bulk quantity and its lower price applies automatically.</p>
          </div>
          <button
            className="fc-primary"
            type="button"
            onClick={() => browse()}
          >Build your basket <ArrowUpRight size={19} />
          </button>
        </section>
        </>}

        <footer className="fc-footer">
          <div>
            <a
              className="fc-brand"
              href="#top"
            >
              <img
                src="/farmconnect.svg"
                alt=""
              />
              <span>Farmconnect</span>
            </a>
            <p>Fresh produce. Closer connections.</p>
          </div>
          <div className="fc-footer-info">
            <p>Farmer to consumer. Freshly connected.</p>
            <details>
              <summary>Photography credits</summary>
              {products.map((product) => <a
                key={product.id}
                href="/produce/credits.html"
                target="_blank"
                rel="noreferrer"
              >
                {product.name} · Photo credit <ArrowUpRight size={12} />
              </a>)}
            </details>
          </div>
        </footer>
      </main>
    </div>

    <p
      className="sr-only"
      role="status"
    >
      {count} products in your basket.</p>
    {count > 0 && !panel && <button
      className="fc-basket-dock"
      type="button"
      onClick={() => openPanel("basket")}
      aria-haspopup="dialog"
    >
      <span
        className="fc-dock-count"
        key={count}
      >
        {count}
      </span>
      <span>Your basket<strong data-pending={!quote && count > 0}>
        {totalLabel} {quote && <small>subtotal</small>}
      </strong>
      </span>
      <span className="fc-dock-action">Open basket <ArrowUpRight size={18} />
      </span>
    </button>}

    {mobile&&!panel&&<nav className="fm-bottom-nav" aria-label="Main app navigation">{[{name:'Home',icon:Home,active:navigation.tab==='home',action:()=>navigation.setTab('home')},{name:'Browse',icon:Grid2X2,active:navigation.tab==='browse',action:()=>navigation.setTab('browse')},{name:'Saved',icon:Heart,active:false,action:()=>requestAccount('saved')},{name:'Orders',icon:ClipboardList,active:false,action:()=>requestAccount('orders')},{name:'Account',icon:UserRound,active:false,action:()=>openPanel('account')}].map(item=><button key={item.name} aria-current={item.active?'page':undefined} onClick={item.action}><item.icon size={21} strokeWidth={item.active?2.4:1.7}/><span>{item.name}</span></button>)}</nav>}
    <dialog
      ref={dialog}
      className={"fc-dialog"+(mobile?" fm-screen":"")}
      data-kind={panel ?? "basket"}
      data-closing={closing}
      aria-labelledby="dialog-title"
      onCancel={(event) => { event.preventDefault(); closePanel(); }}
      onClick={(event) => {
        if (event.target === event.currentTarget)
          closePanel();
      }}
    >
      <div className="fc-dialog-top">
        <span>
          <img
            src="/farmconnect.svg"
            alt=""
          /> Farmconnect</span>
        <button
          type="button"
          className="fc-icon-button"
          onClick={closePanel}
          aria-label="Close dialog" disabled={checkoutBusy}
        >
          {mobile?<ArrowLeft size={22}/>:<X size={22} />}
        </button>
      </div>
      {panel==='product'&&(selectedProduct?<ProductDetail key={selectedProduct.id} product={selectedProduct} quantity={cart[selectedProduct.id]??0} saved={saved.items.some(row=>row.id===selectedProduct.id)} saving={saved.busy!==null} onSave={()=>auth.user?void saved.toggle(selectedProduct):openPanel('account')} onChange={quantity=>changeQuantity(selectedProduct.id,quantity)} onBasket={()=>openPanel('basket')}/>:<div className="fc-account"><h2 id="dialog-title">This harvest is unavailable.</h2><p>The grower may have paused this listing. Browse the shop for available produce.</p><button className="fc-primary" onClick={closePanel}>Back to shopping</button></div>)}
      {panel === "basket" && <>
        <div className="fc-drawer-title">
          <span className="fc-eyebrow">YOUR GOOD FOOD COLLECTION</span>
          <h2 id="dialog-title">Your basket<span>.</span>
          </h2>
          <p>
            {count} {count === 1 ? "product" : "products"}, picked by you.</p>
        </div>
        {rows.length ? <ul className="fc-cart-items">
          {rows.map((product) => {
            const quotedLine = quote?.items.find((item) => item.productId === product.id);
            return <li key={product.id}>
            <img
              src={product.image}
              alt=""
            />
            <div>
              <div className="fc-cart-item-title">
                <h3>
                  {product.name}
                </h3>
                <button
                  className="fc-icon-button"
                  type="button"
                  aria-label={`Remove ${product.name}`}
                  onClick={() => remove(product.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <p>
                {product.farmName} · {product.unit}
              </p>
              <div className="fc-cart-controls">
                <div className="quantity-control">
                  <button
                    type="button"
                    aria-label={`Reduce ${product.name} quantity`}
                    onClick={() => changeQuantity(product.id, -Math.min(cart[product.id],quantityStep(product)))}
                  >
                    <Minus size={14} />
                  </button>
                  <span>
                    {product.saleMode==='weight'?amountLabel(cart[product.id],'weight'):cart[product.id]}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase ${product.name} quantity`}
                    disabled={cart[product.id]+quantityStep(product) > product.stock}
                    onClick={() => changeQuantity(product.id, quantityStep(product))}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <strong>
                  {quotedLine ? money(quotedLine.lineTotalPaise) : "—"}
                </strong>
              </div>
              {quotedLine?.bulkApplied && <small className="fc-bulk-active">Bulk price applied</small>}
            </div>
          </li>;
          })}
        </ul> : <div className="fc-empty fc-cart-empty">
          <ShoppingBag
            size={48}
            strokeWidth={1.3}
          />
          <h3>Room for something good.</h3>
          <p>Your fresh favourites will appear here.</p>
        </div>}
        <div className="fc-cart-total">
          {quote && quote.savingsPaise > 0 && <p className="fc-savings">
            <span>Bulk savings</span>
            <strong>
              {money(quote.savingsPaise)}
            </strong>
          </p>}
          <p>
            <span>Produce subtotal</span>
            <strong data-pending={!quote && count > 0} aria-live="polite">
              {totalLabel}
            </strong>
          </p>
          <small>Delivery is free. Stock is reserved when you place your order.</small>
          {count > 0 && !quote && !quoteError && <div className="fc-quote-status" role="status">
            Checking current prices and stock…
          </div>}
          {quoteError && <div className="fc-quote-error" role="alert">
            <p>{quoteError.message}</p>
            <button type="button" onClick={() => setQuoteAttempt((current) => current + 1)}>Retry prices</button>
            {quoteError.stockChanged && <button type="button" onClick={() => setCatalogAttempt((current) => current + 1)}>
              Refresh availability
            </button>}
          </div>}
          <button
            className="fc-primary"
            type="button"
            onClick={closePanel}
          >Continue shopping <ArrowRight size={18} />
          </button>
          {count > 0 && <button className="fc-primary" type="button" disabled={!quote || auth.loading} onClick={() => requestAccount("checkout")}>{auth.user ? "Continue to checkout" : "Sign in to checkout"}<ArrowRight size={18}/></button>}
          <p className="fc-demo-note">Choose your delivery details and payment at checkout.</p>
        </div>
      </>}
      {panel === "location" && <form
        className="fc-location-form"
        onSubmit={(event) => {
          event.preventDefault(); if (!/^\d{6}$/.test(draft)) {
            setError("Enter a six-digit pincode.");
            return;
          } if (!pincodes.includes(draft)) {
            setError("Delivery is not currently available for this pincode. Choose an available area below.");
            return;
          } setPincode(draft); closePanel();
        }}
      >
        <MapPin size={35} />
        <h2 id="dialog-title">Start with your area.</h2>
        <p>Detect your location or enter a pincode to check delivery availability.</p><LocationAssist onApply={result=>{setDraft(result.address.pincode);setError(result.serviceable?"":"Delivery is not currently available for this pincode.");}}/>
        <label htmlFor="pincode">Delivery pincode</label>
        <input
          id="pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          value={draft}
          aria-invalid={Boolean(error)}
          aria-describedby="location-error"
          onChange={(event) => { setDraft(event.target.value.replace(/\D/g, "")); setError(""); }}
        />
        <p
          className="fc-error"
          id="location-error"
          role="status"
        >
          {error}
        </p>
        <div className="fc-pincodes">
          {pincodes.map((code) => <button
            type="button"
            key={code}
            className={code === draft ? "selected" : ""}
            onClick={() => { setDraft(code); setError(""); }}
          >
            {code}
          </button>)}
        </div>
        <button
          className="fc-primary"
          type="submit"
        >Save area <ArrowRight size={18} />
        </button>
      </form>}
      {panel === "saved" && auth.user && <SavedProducts saved={saved} onAdd={addSavedProduct} onShop={closePanel}/>}
      {panel === "help" && auth.user && <section className="fc-account"><h2 id="dialog-title">Help with your orders.</h2><HelpCenter/></section>}
      {panel === "account" && <AccountPanel auth={auth} onSaved={()=>openPanel('saved')} onHelp={()=>openPanel('help')} onApply={() => openPanel("access")} onFarmer={() => { window.location.href = "/farmer"; }} onBulk={() => openPanel("business")} onAdmin={() => openPanel("admin")} onOrders={() => openPanel("orders")} onCheckout={() => openPanel("checkout")} />}
      {panel === "checkout" && auth.user && <CheckoutPanel mobile={mobile} summaryItems={quote?.items.map(item=>({...item,image:products.find(p=>p.id===item.productId)?.image??''}))??[]} user={auth.user} items={JSON.parse(itemsJson) as CartItem[]} subtotal={quote?.subtotalPaise ?? 0} pincode={pincode} onBusy={setCheckoutBusy} onBack={() => { setQuoteAttempt(value => value + 1); openPanel("basket"); }} onPlaced={(order) => {
        try { localStorage.removeItem(CART_KEY); } catch { /* In-memory cart still clears. */ }
        setCart({}); setReceipt(order); openPanel("receipt"); setCatalogAttempt(value => value + 1);
      }} />}
      {panel === "orders" && auth.user && <OrdersPanel onReorder={repeatOrder} onChanged={() => setCatalogAttempt(value => value + 1)} />}
      {panel === "receipt" && receipt && <div className="fc-account"><OrderReceipt order={receipt}/><button className="fc-primary" onClick={() => openPanel("orders")}>View my orders</button></div>}
      {panel === "admin" && auth.user && <AdminPanel onChanged={() => setCatalogAttempt(value => value + 1)} />}
      {panel === "business" && auth.user?.accountType === "bulk_buyer" && <BulkPanel user={auth.user} onOrders={() => openPanel("orders")} onBasket={() => openPanel("basket")} onAdd={(id,quantity)=>setCart(current=>({...current,[id]:quantity}))} />}
      {panel === "access" && auth.user && <AccessPanel auth={auth} />}
    </dialog>
  </div>);
}





