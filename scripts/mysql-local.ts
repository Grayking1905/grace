import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
const base = resolve('data/tools/mysql-8.4.11-winx64');
const data = resolve('data/mysql-integration');
const init = resolve('data/mysql-test-init.sql');
const connectionFile = resolve('data/mysql-test.json');
const password = randomBytes(24).toString('hex');
const database = `grace_integration_${randomBytes(6).toString('hex')}`;
await writeFile(
  init,
  `ALTER USER 'root'@'localhost' IDENTIFIED BY '${password}';\nCREATE DATABASE ${database} CHARACTER SET utf8mb4;\n`,
);
const child = spawn(
  resolve(base, 'bin/mysqld.exe'),
  [
    '--no-defaults',
    `--basedir=${base}`,
    `--datadir=${data}`,
    `--init-file=${init}`,
    '--bind-address=127.0.0.1',
    '--port=3408',
    '--mysqlx=0',
    '--console',
  ],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
);
let ready = false;
child.stderr.on('data', (chunk) => {
  if (String(chunk).includes('[ERROR]')) process.stderr.write(chunk);
});
for (let attempt = 0; attempt < 100; attempt++) {
  if (child.exitCode !== null) throw new Error(`MySQL exited: ${child.exitCode}`);
  try {
    const connection = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3408,
      user: 'root',
      password,
      database,
    });
    const [rows] = await connection.query('SELECT VERSION() AS version');
    await connection.end();
    await writeFile(
      connectionFile,
      JSON.stringify({ url: `mysql://root:${password}@127.0.0.1:3408/${database}` }),
    );
    console.log(
      `Local MySQL integration runtime ready: ${(rows as { version: string }[])[0].version}; isolated database ${database}.`,
    );
    ready = true;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
await rm(init, { force: true });
if (!ready) {
  child.kill();
  throw new Error('MySQL did not become ready.');
}
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
await new Promise<void>((done) => child.on('exit', () => done()));
await rm(connectionFile, { force: true });
