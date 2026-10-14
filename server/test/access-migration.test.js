import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migrateDatabase } from '../src/db.js';
import { profileFor } from '../src/profiles.js';
import { listProducts } from '../src/catalog.js';
test('migration locks previously self-selected partners without deleting farm ownership or listings',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT DEFAULT CURRENT_TIMESTAMP) STRICT;');
 try{
  for(const name of ['001_catalog.sql','002_accounts.sql','003_orders.sql','004_admin.sql','005_marketplace.sql']){db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(name);}
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('legacy','Legacy Farmer','legacy@example.test','unused','customer',1);
  db.prepare('INSERT INTO farms VALUES (?,?)').run('legacy-farm','Legacy Farm');
  db.prepare("INSERT INTO account_profiles VALUES ('legacy','farmer','Legacy Farm','legacy-farm')").run();
  db.prepare("INSERT INTO products(id,farm_id,name,category,unit,price_paise,bulk_price_paise,bulk_min,stock,image,photo_credit) VALUES ('legacy-product','legacy-farm','Legacy produce','Vegetables','1 kg',5000,4000,10,20,'/farmconnect.svg','')").run();
  migrateDatabase(db);migrateDatabase(db);
  assert.equal(profileFor(db,'legacy').accountType,'consumer');assert.equal(profileFor(db,'legacy').accessStatus,'pending');assert.equal(listProducts(db).length,0);
  assert.equal(db.prepare('SELECT farm_id FROM account_profiles').get().farm_id,'legacy-farm');
  assert.equal(db.prepare('SELECT stock FROM products').get().stock,20);
  assert.equal(db.prepare('SELECT status FROM access_applications').get().status,'needs_information');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
