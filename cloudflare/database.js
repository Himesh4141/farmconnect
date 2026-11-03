export class CloudDatabase {
  constructor(storage) { this.storage = storage; }
  exec(sql) { return this.storage.sql.exec(sql); }
  prepare(sql) {
    const execute = args => this.storage.sql.exec(sql, ...args.map(value => Buffer.isBuffer(value) ? new Uint8Array(value) : value));
    const row = value => value && Object.fromEntries(Object.entries(value).map(([k,v]) => [k, v instanceof ArrayBuffer ? Buffer.from(v) : v]));
    return {
      get: (...args) => row(execute(args).toArray()[0]),
      all: (...args) => execute(args).toArray().map(row),
      run: (...args) => { execute(args).toArray(); return this.storage.sql.exec('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid').one(); },
    };
  }
  atomic(callback) { return this.storage.transactionSync(() => { const value=callback(); if(value && typeof value.then==='function')throw Error('Async database transaction'); return value; }); }
}
export function migrate(db, migrations) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT");
  for(const {name,sql} of migrations) db.atomic(() => {
    if(db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name))return;
    db.exec(sql); db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(name);
  });
}
