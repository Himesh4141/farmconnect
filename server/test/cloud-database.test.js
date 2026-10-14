import test from 'node:test';
import assert from 'node:assert/strict';
import { databasePath, openDatabase } from '../src/db.js';
import { readConfig } from '../src/config.js';

test('cloud configuration never silently creates an ephemeral database', () => {
  const keys=['TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','RENDER','NODE_ENV'];
  const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try {
    for(const key of keys)delete process.env[key];
    process.env.RENDER='true';process.env.NODE_ENV='production';
    assert.throws(()=>databasePath(),/requires Turso/);
    process.env.TURSO_DATABASE_URL='libsql://fixture.turso.io';
    assert.throws(()=>databasePath(),/both TURSO/);
    process.env.TURSO_AUTH_TOKEN='non-secret-fixture';
    assert.equal(databasePath(),'libsql://fixture.turso.io');
    for(const invalid of ['http://fixture.turso.io','libsql://fixture.turso.io@evil.example','https://fixture.turso.io/path','https://fixture.turso.io?token=hidden']){
      process.env.TURSO_DATABASE_URL=invalid;
      assert.throws(()=>databasePath());
    }
  } finally { for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];} }
});

test('libSQL records expose only database columns to application code',()=>{
  const before=process.env.DATABASE_DRIVER;process.env.DATABASE_DRIVER='libsql';
  let db;
  try {
    db=openDatabase(':memory:');
    assert.deepEqual(Object.keys(db.prepare('SELECT 1 AS value').get()),['value']);
    assert.deepEqual(db.prepare('SELECT 1 AS value').all(),[{value:1}]);
    assert.equal(db.prepare('SELECT 1 WHERE 0').get(),undefined);
  } finally {db?.close();if(before===undefined)delete process.env.DATABASE_DRIVER;else process.env.DATABASE_DRIVER=before;}
});

test('Render proxy configuration is opt-in and restricted to its platform',()=>{
  assert.throws(()=>readConfig({TRUST_PROXY:'render'}));
  assert.equal(readConfig({TRUST_PROXY:'render',RENDER:'true'}).trustProxy,1);
  assert.equal(readConfig({}).trustProxy,false);
});
