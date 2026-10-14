import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { openDatabase, seedDatabase } from "../src/db.js";

async function fixture(t) {
  const db = openDatabase(":memory:");
  seedDatabase(db);
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, options) {
    const response = await fetch(base + path, options);
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const quote = (body) => request("/api/cart/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { db, request, quote };
}

test("catalogue and product endpoints reflect saved database changes", async (t) => {
  const { db, request } = await fixture(t);
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.database, "connected");
  assert.equal(health.body.application, "Farmconnect");
  assert.equal(health.body.apiVersion, 1);

  db.prepare("UPDATE products SET price_paise = 4800, stock = 7 WHERE id = ?").run("tomatoes");
  db.prepare("UPDATE farms SET name = ? WHERE id = ?").run("Updated grower", "sahyadri-growers");
  db.prepare("UPDATE delivery_areas SET active = 0 WHERE pincode = ?").run("411001");

  for (const path of ["/api/catalog", "/api/products"]) {
    const result = await request(path);
    assert.equal(result.status, 200);
    const product = result.body.products.find((item) => item.id === "tomatoes");
    assert.equal(product.pricePaise, 4800);
    assert.equal(product.stock, 7);
    assert.equal(product.farmName, "Updated grower");
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("x-powered-by"), null);
    if (path === "/api/catalog") assert.ok(!result.body.deliveryPincodes.includes("411001"));
  }
  const detail = await request("/api/products/tomatoes");
  assert.equal(detail.body.product.pricePaise, 4800);
  assert.equal(detail.body.product.stock, 7);
});

test("inactive and missing products cannot be purchased or viewed", async (t) => {
  const { db, request, quote } = await fixture(t);
  db.prepare("UPDATE products SET active = 0 WHERE id = ?").run("tomatoes");
  const catalog = await request("/api/catalog");
  assert.ok(!catalog.body.products.some((product) => product.id === "tomatoes"));
  for (const productId of ["tomatoes", "missing-product", "tomatoes-or-1-1"]) {
    assert.equal((await request(`/api/products/${productId}`)).status, 404);
    const result = await quote({ items: [{ productId, quantity: 1 }] });
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, "PRODUCT_UNAVAILABLE");
  }
  assert.equal((await request("/api/no-such-route")).status, 404);
});

test("bulk rates apply at the threshold and server prices override client totals", async (t) => {
  const { db, quote } = await fixture(t);
  db.prepare("UPDATE products SET price_paise = 4700, bulk_price_paise = 3900 WHERE id = ?").run("tomatoes");

  const retail = await quote({ items: [{ productId: "tomatoes", quantity: 9 }] });
  assert.equal(retail.status, 200);
  assert.equal(retail.body.subtotalPaise, 42300);
  assert.equal(retail.body.savingsPaise, 0);
  assert.equal(retail.body.items[0].bulkApplied, false);

  const bulk = await quote({
    subtotalPaise: 1,
    deliveryFeePaise: -100,
    items: [
      { productId: "tomatoes", quantity: 10, pricePaise: 1, unitPricePaise: 1, lineTotalPaise: 1 },
      { productId: "spinach", quantity: 2 },
    ],
  });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.currency, "INR");
  assert.equal(bulk.body.items[0].unitPricePaise, 3900);
  assert.equal(bulk.body.items[0].lineTotalPaise, 39000);
  assert.equal(bulk.body.items[0].bulkApplied, true);
  assert.equal(bulk.body.subtotalPaise, 44000);
  assert.equal(bulk.body.savingsPaise, 8000);
  assert.equal(bulk.body.deliveryFeePaise, null);
});

test("invalid quantities and malformed basket structures receive 400", async (t) => {
  const { quote } = await fixture(t);
  const badBodies = [
    {}, [], null, { items: [] }, { items: "tomatoes" },
    { items: [null] }, { items: [[]] }, { items: [{}] },
    { items: [{ productId: 123, quantity: 1 }] },
    { items: [{ productId: "tomatoes' OR 1=1--", quantity: 1 }] },
    { items: [{ productId: "x".repeat(81), quantity: 1 }] },
    { items: Array.from({ length: 51 }, (_, i) => ({ productId: `product-${i}`, quantity: 1 })) },
    { items: [{ productId: "tomatoes", quantity: 1 }, { productId: "tomatoes", quantity: 9 }] },
    ...[0, -1, 1.5, "2", true, null, 10001, Number.MAX_SAFE_INTEGER + 1].map((quantity) => ({
      items: [{ productId: "tomatoes", quantity }],
    })),
  ];
  for (const body of badBodies) {
    const result = await quote(body);
    assert.equal(result.status, 400, `Accepted invalid cart: ${JSON.stringify(body)}`);
    assert.ok(result.body.error.message);
  }
});

test("stock conflicts return 409 and quoting never reserves or removes stock", async (t) => {
  const { db, quote } = await fixture(t);
  db.prepare("UPDATE products SET stock = 3 WHERE id = ?").run("tomatoes");
  const valid = { items: [{ productId: "tomatoes", quantity: 3 }] };
  assert.equal((await quote(valid)).status, 200);
  assert.equal((await quote(valid)).status, 200);
  assert.equal(db.prepare("SELECT stock FROM products WHERE id = ?").get("tomatoes").stock, 3);

  for (const quantity of [4, 10000]) {
    const result = await quote({ items: [{ productId: "tomatoes", quantity }] });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "INSUFFICIENT_STOCK");
  }
  db.prepare("UPDATE products SET stock = 0 WHERE id = ?").run("tomatoes");
  assert.equal((await quote({ items: [{ productId: "tomatoes", quantity: 1 }] })).status, 409);

  // A failed quote must release its transaction so subsequent quotes work.
  assert.equal((await quote({ items: [{ productId: "onions", quantity: 1 }] })).status, 200);
});

test("invalid JSON and oversized bodies receive safe structured errors", async (t) => {
  const { request } = await fixture(t);
  const malformed = await request("/api/cart/quote", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"items":',
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "INVALID_JSON");

  const oversized = await request("/api/cart/quote", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(20000) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, "REQUEST_TOO_LARGE");
  assert.equal((await request("/api/health")).status, 200);
});
