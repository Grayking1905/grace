import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Database } from '../server/db.js';
import { createBackup, restoreBackup } from '../server/backup.js';
const [action, file] = process.argv.slice(2);
if (!['create', 'restore'].includes(action) || !file)
  throw new Error(
    'Usage: npm run db:backup -- create|restore <file.gracebackup>. Restore only into an empty configured database.',
  );
const db = new Database();
try {
  if (action === 'create') {
    const buffer = await createBackup(db, process.env.BACKUP_KEY || '');
    await writeFile(resolve(file), buffer, { flag: 'wx' });
    console.log(
      'Encrypted database backup created. Uploaded files require a separate filesystem backup.',
    );
  } else {
    await restoreBackup(db, await readFile(resolve(file)), process.env.BACKUP_KEY || '');
    console.log('Database restored into the empty target.');
  }
} finally {
  await db.close();
}
