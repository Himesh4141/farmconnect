import { findProduct } from "./catalog.js";

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid(message) {
  throw new ApiError(400, "INVALID_CART", message);
}

export function quoteCart(db, body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.items)) {
    invalid("Send an items array containing productId and quantity.");
  }
  if (body.items.length < 1 || body.items.length > 50) {
    invalid("A basket must contain between 1 and 50 different products.");
  }

  const seen = new Set();
  for (const item of body.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid("Each basket item must be an object.");
    if (typeof item.productId !== "string" || !/^[a-z0-9-]{1,80}$/.test(item.productId)) {
      invalid("Each item needs a valid productId.");
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000000) {
      invalid("Each quantity must be a whole number between 1 and 100000000.");
    }
    if (seen.has(item.productId)) invalid("Include each product only once in the basket.");
    seen.add(item.productId);
  }

  // One read transaction gives every line a consistent database snapshot.
  db.exec("SAVEPOINT cart_quote");
  try {
    let subtotalPaise = 0;
    let savingsPaise = 0;
    const items = body.items.map(({ productId, quantity }) => {
      const product = findProduct(db, productId);
      if (!product) throw new ApiError(404, "PRODUCT_UNAVAILABLE", "A product in your basket is no longer available. Refresh the catalogue.");
      const weight=product.saleMode==='weight';
      if(weight?(quantity<50||quantity%50!==0):quantity>10000)invalid(weight?'Choose weight in multiples of 50 g.':'Maximum 10000 packs per order.');
      if (quantity > product.stock) {
        throw new ApiError(409, "INSUFFICIENT_STOCK", `${product.name} has ${weight ? (product.stock/1000)+' kg' : product.stock+' packs'} available. Reduce its quantity or refresh the catalogue.`);
      }
      const bulkApplied = quantity >= product.bulkMin;
      const unitPricePaise = bulkApplied ? product.bulkPricePaise : product.pricePaise;
      const lineTotalPaise = Math.round(unitPricePaise * quantity / (weight?1000:1));
      subtotalPaise += lineTotalPaise;
      savingsPaise += Math.round(product.pricePaise*quantity/(weight?1000:1))-lineTotalPaise;
      if(lineTotalPaise<1)invalid('Choose a larger weight for this price.');
      return { saleMode:product.saleMode, productId, name: product.name, unit: product.unit, quantity, unitPricePaise, lineTotalPaise, bulkApplied };
    });
    db.exec("RELEASE cart_quote");
    return { currency: "INR", items, subtotalPaise, savingsPaise, deliveryFeePaise: null };
  } catch (error) {
    db.exec("ROLLBACK TO cart_quote; RELEASE cart_quote");
    throw error;
  }
}

