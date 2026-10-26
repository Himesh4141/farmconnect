export type Product = {
  rating?: number | null;
  reviewCount?: number;
  saleMode?: 'pack' | 'weight';
  presetId?: string;
  id: string;
  name: string;
  farmName: string;
  category: string;
  unit: string;
  pricePaise: number;
  bulkPricePaise: number;
  bulkMin: number;
  stock: number;
  image: string;
  photoCredit: string;
  variety?: string;
  qualityNotes?: string;
  harvestDate?: string;
  farmCity?: string;
};

export function money(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(paise / 100);
}

export function unitPrice(product: Product, quantity: number) {
  return quantity >= product.bulkMin
    ? product.bulkPricePaise
    : product.pricePaise;
}



export function amountLabel(quantity:number, saleMode?:string, unit='pack'){return saleMode==='weight'?(quantity<1000?quantity+' g':Number((quantity/1000).toFixed(3))+' kg'):quantity+' × '+unit;}
export function orderLineTotal(item:{quantity:number;unitPricePaise:number;lineTotalPaise?:number;saleMode?:string}){return item.lineTotalPaise??Math.round(item.quantity*item.unitPricePaise/(item.saleMode==='weight'?1000:1));}
export function quantityStep(product:Product){return product.saleMode==='weight'?250:1;}
