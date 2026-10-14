import { backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { databasePath, openDatabase, seedDatabase, serverDirectory } from "./db.js";
import { listProducts } from "./catalog.js";

const [command, id, first, second] = process.argv.slice(2);
const db = openDatabase();

function integer(value, label, minimum, maximum) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${label} must be a whole number.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function requireProduct() {
  if (!id || !db.prepare("SELECT id FROM products WHERE id = ?").get(id)) {
    throw new Error("Product not found. Run npm.cmd run db:list to see product IDs.");
  }
}

try {
  switch (command) {
    case "migrate":
      console.log(`Database schema is ready: ${databasePath()}`);
      break;
    case "seed":
      seedDatabase(db);
      console.log("Sample catalogue added. Existing product prices and stock were preserved.");
      console.log(`Database: ${databasePath()}`);
      break;
    case "list":
      console.table(listProducts(db).map((product) => ({
        id: product.id, name: product.name, grower: product.farmName,
        priceINR: product.pricePaise / 100, bulkINR: product.bulkPricePaise / 100,
        bulkMin: product.saleMode==='weight'?product.bulkMin/1000:product.bulkMin, stock: product.saleMode==='weight'?product.stock/1000:product.stock, stockUnit:product.saleMode==='weight'?'kg':'packs',
      })));
      console.log(`Database: ${databasePath()}`);
      break;
    case "stock": {
      if(db.prepare("SELECT sale_mode FROM products WHERE id=?").get(id)?.sale_mode==='weight')throw new Error('Manage kg stock in the farmer workspace. This command updates legacy packs only.');
      requireProduct();
      const stock = integer(first, "Stock", 0, 1000000);
      db.prepare("UPDATE products SET revision=revision+1, stock = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(stock, id);
      console.log(`${id}: stock saved as ${stock} packs. Refresh the storefront to load the updated catalogue.`);
      break;
    }
    case "price": {
      requireProduct();
      const price = integer(first, "Regular price in paise", 1, 100000000);
      const bulk = integer(second, "Bulk price in paise", 1, price);
      db.prepare("UPDATE products SET revision=revision+1, price_paise = ?, bulk_price_paise = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(price, bulk, id);
      console.log(`${id}: regular INR ${(price / 100).toFixed(2)}, bulk INR ${(bulk / 100).toFixed(2)}. Refresh the storefront.`);
      break;
    }
    case "backup": {
      if (/^(libsql|https):\/\//.test(databasePath())) throw new Error('This is a Turso cloud database. Use Turso database export/point-in-time restore; local SQLite backup cannot copy a remote database.');
      const directory = resolve(serverDirectory, "backups");
      mkdirSync(directory, { recursive: true });
      const filename = resolve(directory, `farmconnect-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
      await backup(db, filename);
      console.log(`Consistent SQLite backup saved: ${filename}`);
      break;
    }
    default:
      throw new Error("Use db:migrate, db:seed, db:list, db:stock, db:price, or db:backup from package.json.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}

