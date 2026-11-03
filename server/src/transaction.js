// Keep the same business transaction boundaries on Node SQLite and Cloudflare storage.
const depths = new WeakMap();
export function atomic(db, callback) {
  if (typeof db.atomic === 'function') return db.atomic(callback);
  const depth = depths.get(db) || 0, savepoint = 'fc_nested_' + depth;
  db.exec(depth ? 'SAVEPOINT ' + savepoint : 'BEGIN IMMEDIATE');
  depths.set(db, depth + 1);
  try {
    const result = callback();
    if (result && typeof result.then === 'function') throw new Error('Database transactions must be synchronous.');
    db.exec(depth ? 'RELEASE ' + savepoint : 'COMMIT');
    return result;
  } catch (error) {
    db.exec(depth ? 'ROLLBACK TO ' + savepoint + '; RELEASE ' + savepoint : 'ROLLBACK');
    throw error;
  } finally { depths.set(db, depth); }
}
