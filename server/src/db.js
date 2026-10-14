import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = new URL("../migrations/", import.meta.url);

export function databasePath() {
  if (process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN) {
    const value = process.env.TURSO_DATABASE_URL;
    if (!value || !process.env.TURSO_AUTH_TOKEN) throw new Error('Set both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. Local fallback is disabled.');
    const url = new URL(value);
    if (!['libsql:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.hostname.endsWith('.turso.io') || !['', '/'].includes(url.pathname)) throw new Error('Use the secure database URL supplied by Turso.');
    return value;
  }
  if (process.env.RENDER === 'true' && process.env.NODE_ENV === 'production') throw new Error('Render requires Turso storage. Its local disk does not preserve accounts and orders.');
  return resolve(serverDirectory, process.env.DATABASE_PATH || "data/farmconnect.db");
}

export function openDatabase(filename = databasePath()) {
  const remote = /^(libsql|https):\/\//.test(filename);
  if (!remote && filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  // Local files retain Node SQLite. The switch exercises libSQL with disposable memory fixtures only.
  const useLibsql = remote || (filename === ':memory:' && process.env.DATABASE_DRIVER === 'libsql');
  const db = useLibsql
    ? new (require('libsql'))(filename, { authToken: remote ? process.env.TURSO_AUTH_TOKEN : undefined, timeout: 5 })
    : new DatabaseSync(filename, { timeout: 5000 });
  if (useLibsql) {
    const prepare = db.prepare.bind(db);
    const clean = row => { if (row === undefined) return row; const { _metadata, ...values } = row; return values; };
    db.prepare = sql => {
      const statement = prepare(sql), get = statement.get.bind(statement), all = statement.all.bind(statement);
      statement.get = (...args) => clean(get(...args));
      statement.all = (...args) => all(...args).map(clean);
      return statement;
    };
  }
  try {
    db.exec(remote ? 'PRAGMA foreign_keys = ON;' : "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    migrateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function migrateDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
  `);
  const files = readdirSync(migrationsDirectory)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  for (const filename of files) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const alreadyApplied = db.prepare("SELECT name FROM schema_migrations WHERE name = ?").get(filename);
      if (!alreadyApplied) {
        db.exec(readFileSync(new URL(filename, migrationsDirectory), "utf8"));
        db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(filename);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function seedDatabase(db) {
  const products = JSON.parse(readFileSync(new URL("../seed/products.json", import.meta.url), "utf8"));
  const insertFarm = db.prepare("INSERT INTO farms (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING");
  const insertProduct = db.prepare(`
    INSERT INTO products (
      id, farm_id, name, category, unit, price_paise, bulk_price_paise,
      bulk_min, stock, image, photo_credit, display_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertArea = db.prepare("INSERT INTO delivery_areas (pincode) VALUES (?) ON CONFLICT(pincode) DO NOTHING");

  db.exec("BEGIN IMMEDIATE");
  try {
    products.forEach((product, index) => {
      const farmId = product.farmName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      insertFarm.run(farmId, product.farmName);
      insertProduct.run(
        product.id, farmId, product.name, product.category, product.unit,
        product.pricePaise, product.bulkPricePaise, product.bulkMin,
        product.stock, product.image, product.photoCredit, index,
      );
    });
    ["411001", "411007", "411021", "411045", "411057"].forEach((pincode) => insertArea.run(pincode));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
