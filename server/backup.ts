import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { Database } from './db.js';
import { tables } from './schema.js';
import { now } from './seed.js';
import { applySearchMigration } from './features/search.js';
export async function createBackup(db: Database, password: string) {
  if (password.length < 32) throw new Error('BACKUP_KEY must contain at least 32 characters.');
  const payload = await db.transaction(async () => {
    const records: Record<string, Record<string, unknown>[]> = {};
    for (const table of Object.keys(tables))
      records[table] = await db.all(`SELECT * FROM ${table}`);
    return { format: 'grace-database-backup', version: 1, created_at: now(), records };
  });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.from(
    JSON.stringify({
      format: 'grace-encrypted-backup',
      version: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    }),
  );
}
export async function restoreBackup(db: Database, backup: Buffer, password: string) {
  if (password.length < 32 || backup.length > 128 * 1024 * 1024)
    throw new Error('Invalid backup key or file size.');
  let payload: {
    format: string;
    version: number;
    records: Record<string, Record<string, unknown>[]>;
  };
  try {
    const envelope = JSON.parse(backup.toString('utf8'));
    if (envelope.format !== 'grace-encrypted-backup' || envelope.version !== 1) throw new Error();
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
    decipher.setAuthTag(tag);
    payload = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64')),
        decipher.final(),
      ]).toString('utf8'),
    );
  } catch {
    throw new Error('The backup could not be authenticated. Check its integrity and BACKUP_KEY.');
  }
  if (
    payload.format !== 'grace-database-backup' ||
    payload.version !== 1 ||
    Object.keys(payload.records).some((table) => !Object.hasOwn(tables, table))
  )
    throw new Error('Unsupported database backup.');
  await db.migrate();
  await db.transaction(async () => {
    for (const table of Object.keys(tables).filter((t) => t !== 'schema_migrations'))
      if (await db.one(`SELECT 1 AS present FROM ${table} LIMIT 1`))
        throw new Error(
          'Restore requires an empty target database. Existing records will not be overwritten.',
        );
    await db.run('DELETE FROM schema_migrations');
    for (const table of Object.keys(tables)) {
      let rows = payload.records[table] || [];
      if (table === 'issues') {
        const byId = new Map(rows.map((row) => [row.id, row]));
        const visited = new Set<unknown>();
        const visiting = new Set<unknown>();
        const ordered: Record<string, unknown>[] = [];
        const visit = (row: Record<string, unknown>) => {
          if (visited.has(row.id)) return;
          if (visiting.has(row.id)) throw new Error('Cyclic issue hierarchy in backup.');
          visiting.add(row.id);
          if (row.parent_id && byId.has(row.parent_id)) visit(byId.get(row.parent_id)!);
          visiting.delete(row.id);
          visited.add(row.id);
          ordered.push(row);
        };
        rows.forEach(visit);
        rows = ordered;
      }
      for (const row of rows) await db.insert(table, row);
    }
    // Restoring an older database must not revive revoked browser sessions or links.
    await db.run('DELETE FROM sessions');
    await db.run('UPDATE account_tokens SET consumed_at=? WHERE consumed_at IS NULL', [now()]);
  });
  await applySearchMigration(db);
}
