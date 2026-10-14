import type { Product } from "../data/products";

export type Catalog = {
  products: Product[];
  categories: string[];
  deliveryPincodes: string[];
};

export type CartItem = { productId: string; quantity: number };

export type CartQuote = {
  currency: "INR";
  items: {
    saleMode?: string;
    productId: string;
    name: string;
    unit: string;
    quantity: number;
    unitPricePaise: number;
    lineTotalPaise: number;
    bulkApplied: boolean;
  }[];
  subtotalPaise: number;
  savingsPaise: number;
  deliveryFeePaise: null;
};

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isProduct(value: unknown): value is Product {
  if (!isRecord(value)) return false;
  const textKeys = ["id", "name", "farmName", "category", "unit", "image", "photoCredit"];
  return textKeys.every((key) => typeof value[key] === "string") &&
    isWholeNumber(value.pricePaise) && isWholeNumber(value.bulkPricePaise) &&
    isWholeNumber(value.stock) && isWholeNumber(value.bulkMin) && value.bulkMin > 0;
}

function invalidResponse(): never {
  throw new ApiError("The server returned an unexpected response. Please try again.", "INVALID_RESPONSE");
}

async function request(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10000);

  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? { Accept: "application/json" } : {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      throw new ApiError("The catalogue service is unavailable. Please try again.", "INVALID_RESPONSE", response.status);
    }

    if (!response.ok) {
      const error = isRecord(data) && isRecord(data.error) ? data.error : null;
      throw new ApiError(
        typeof error?.message === "string" ? error.message : "The request could not be completed. Please try again.",
        typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
        response.status,
      );
    }
    return data;
  } catch (error) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (timedOut) throw new ApiError("The server took too long to respond. Please try again.", "TIMEOUT");
    if (error instanceof ApiError) throw error;
    throw new ApiError("Unable to reach the server. Check your connection and try again.", "NETWORK_ERROR");
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export async function getCatalog(signal: AbortSignal): Promise<Catalog> {
  const data = await request("/api/catalog", signal);
  if (!isRecord(data) || !Array.isArray(data.products) ||
    !data.products.every(isProduct) || !Array.isArray(data.categories) ||
    !data.categories.every((value) => typeof value === "string") ||
    !data.categories.includes("All produce") || !Array.isArray(data.deliveryPincodes) ||
    !data.deliveryPincodes.every((value) => typeof value === "string")) {
    return invalidResponse();
  }
  return data as Catalog;
}

export async function getCartQuote(items: CartItem[], signal: AbortSignal): Promise<CartQuote> {
  const data = await request("/api/cart/quote", signal, { items });
  if (!isRecord(data) || data.currency !== "INR" || data.deliveryFeePaise !== null ||
    !isWholeNumber(data.subtotalPaise) || !isWholeNumber(data.savingsPaise) ||
    !Array.isArray(data.items) || !data.items.every((item) =>
      isRecord(item) && typeof item.productId === "string" &&
      typeof item.name === "string" && typeof item.unit === "string" &&
      isWholeNumber(item.quantity) && item.quantity > 0 &&
      isWholeNumber(item.unitPricePaise) && isWholeNumber(item.lineTotalPaise) &&
      typeof item.bulkApplied === "boolean")) {
    return invalidResponse();
  }
  const quote = data as CartQuote;
  if (quote.items.length !== items.length || new Set(quote.items.map((item) => item.productId)).size !== items.length ||
    !items.every((requested) => quote.items.some((item) =>
      item.productId === requested.productId && item.quantity === requested.quantity))) {
    return invalidResponse();
  }
  return quote;
}
