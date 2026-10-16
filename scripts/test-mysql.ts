import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
let url = process.env.GRACE_MYSQL_URL;
if (!url) url = JSON.parse(await readFile('data/mysql-test.json', 'utf8')).url;
if (!url || !/^grace_(integration|ci|test)[a-z0-9_]*$/i.test(new URL(url).pathname.slice(1)))
  throw new Error('Use a dedicated grace_integration_*, grace_ci, or grace_test database.');
const child = spawn(
  process.execPath,
  [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/mysql.test.ts'],
  {
    env: { ...process.env, GRACE_MYSQL_TEST: 'true', GRACE_MYSQL_URL: url },
    stdio: 'inherit',
    windowsHide: true,
  },
);
child.on('exit', (code) => (process.exitCode = code || 0));
