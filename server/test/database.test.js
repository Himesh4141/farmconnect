import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { openDatabase, seedDatabase, migrateDatabase } from "../src/db.js";

test("repeated migrations and seeds preserve product edits without duplicating data", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  seedDatabase(db);
  db.prepare("UPDATE products SET price_paise = 4900, stock = 4, active = 0 WHERE id = ?").run("tomatoes");
  migrateDatabase(db);
  seedDatabase(db);
  seedDatabase(db);
  const row = db.prepare("SELECT price_paise, stock, active FROM products WHERE id = ?").get("tomatoes");
  assert.equal(row.price_paise, 4900);
  assert.equal(row.stock, 4);
  assert.equal(row.active, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM products").get().count, 6);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM farms").get().count, 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM delivery_areas").get().count, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 20);
});

test("database changes survive closing and reopening the database file", () => {
  const directory = mkdtempSync(join(tmpdir(), "farmconnect-database-test-"));
  const filename = join(directory, "test.db");
  let db;
  try {
    db = openDatabase(filename);
    seedDatabase(db);
    db.prepare("UPDATE products SET stock = 19, price_paise = 4800 WHERE id = ?").run("tomatoes");
    db.close();
    db = undefined;
    db = openDatabase(filename);
    seedDatabase(db);
    const row = db.prepare("SELECT stock, price_paise FROM products WHERE id = ?").get("tomatoes");
    assert.equal(row.stock, 19);
    assert.equal(row.price_paise, 4800);
  } finally {
    db?.close();
    // directory is the unique test-owned folder returned by mkdtempSync above.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("farmconnect-database-test-"));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("database constraints prevent invalid stock, prices, categories and farm references", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  seedDatabase(db);
  const invalidUpdates = [
    "stock = -1", "stock = 1.5", "stock = 1000001",
    "price_paise = 0", "price_paise = 100000001", "price_paise = 100",
    "bulk_price_paise = 5000", "bulk_price_paise = 0", "bulk_min = 1",
    "active = 2", "category = 'Invalid category'", "farm_id = 'missing-farm'",
  ];
  for (const assignment of invalidUpdates) {
    assert.throws(() => db.exec(`UPDATE products SET ${assignment} WHERE id = 'tomatoes'`), assignment);
  }
  assert.throws(() => db.prepare("DELETE FROM farms WHERE id = ?").run("sahyadri-growers"));
  for (const code of ["12345", "1234567", "abcdef", "12345 "]) {
    assert.throws(() => db.prepare("INSERT INTO delivery_areas (pincode) VALUES (?)").run(code));
  }
  assert.equal(db.prepare("SELECT stock FROM products WHERE id = 'tomatoes'").get().stock, 50);
});






test('photo migration upgrades default artwork without replacing custom farmer photos or changing inventory',t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());seedDatabase(db);
 db.prepare("UPDATE products SET image='/produce/tomatoes.svg',revision=4,stock=23,price_paise=5100 WHERE id='tomatoes'").run();
 const other=db.prepare("SELECT id FROM products WHERE id!='tomatoes' LIMIT 1").get().id;
 db.prepare('UPDATE products SET image=?,revision=3 WHERE id=?').run('https://example.test/my-own-harvest.jpg',other);
 db.prepare("DELETE FROM schema_migrations WHERE name='009_real_produce_photos.sql'").run();
 migrateDatabase(db);
 const tomato=db.prepare("SELECT * FROM products WHERE id='tomatoes'").get();
 assert.equal(tomato.image,'/produce/photos/tomatoes.jpg');assert.equal(tomato.revision,5);assert.equal(tomato.stock,23);assert.equal(tomato.price_paise,5100);assert.match(tomato.photo_credit,/Wikimedia Commons/);
 const custom=db.prepare('SELECT image,revision FROM products WHERE id=?').get(other);assert.equal(custom.image,'https://example.test/my-own-harvest.jpg');assert.equal(custom.revision,3);
 migrateDatabase(db);assert.equal(db.prepare("SELECT revision FROM products WHERE id='tomatoes'").get().revision,5);
});
