import type { Database } from './db.js';
import { now } from './seed.js';
export async function applyExpansionMigrations(db: Database) {
  await db.transaction(async () => {
    await db.one(
      'SELECT version FROM schema_migrations WHERE version=1' +
        (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
    );
    if (await db.one('SELECT version FROM schema_migrations WHERE version=4')) return;
    await db.run(
      "INSERT INTO account_security (user_id,verified_at) SELECT u.id,CASE WHEN u.email LIKE '%@grace.local' THEN ? ELSE NULL END FROM users u WHERE NOT EXISTS (SELECT 1 FROM account_security a WHERE a.user_id=u.id)",
      [now()],
    );
    await db.insert('schema_migrations', { version: 4, applied_at: now() });
  });
}
