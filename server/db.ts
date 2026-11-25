import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import mysql, {
  type PoolConnection,
  type RowDataPacket,
  type ResultSetHeader,
} from 'mysql2/promise';
import { tables, indexes } from './schema.js';

export class Database {
  driver: 'mysql' | 'sqlite';
  private sqlite?: DatabaseSync;
  private pool?: mysql.Pool;
  private context = new AsyncLocalStorage<PoolConnection | true>();
  private commitCallbacks = new AsyncLocalStorage<(() => void)[]>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    driver = process.env.DB_DRIVER || 'sqlite',
    path = process.env.SQLITE_PATH || './data/grace.sqlite',
  ) {
    if (!['mysql', 'sqlite'].includes(driver)) throw new Error('DB_DRIVER must be mysql or sqlite');
    this.driver = driver as 'mysql' | 'sqlite';
    if (this.driver === 'mysql') {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for MySQL');
      this.pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        connectionLimit: 10,
        decimalNumbers: true,
      });
    } else {
      if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
      this.sqlite = new DatabaseSync(path);
      this.sqlite.exec(
        'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -16000; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
      );
    }
  }
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this.pool) {
      const client = this.context.getStore() || this.pool;
      const [rows] = await (client as mysql.Pool | PoolConnection).execute<RowDataPacket[]>(
        sql,
        params as (string | number | null)[],
      );
      return rows as T[];
    }
    const run = async () =>
      this.sqlite!.prepare(sql).all(...(params as (string | number | null)[])) as T[];
    return this.context.getStore() ? run() : this.locked(run);
  }
  async one<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0];
  }
  async run(sql: string, params: unknown[] = []): Promise<number> {
    if (this.pool) {
      const client = this.context.getStore() || this.pool;
      const [result] = await (client as mysql.Pool | PoolConnection).execute<ResultSetHeader>(
        sql,
        params as (string | number | null)[],
      );
      return result.affectedRows;
    }
    const run = async () =>
      Number(this.sqlite!.prepare(sql).run(...(params as (string | number | null)[])).changes);
    return this.context.getStore() ? run() : this.locked(run);
  }
  async insert(table: string, row: Record<string, unknown>) {
    if (!(table in tables)) throw new Error('Unknown table');
    const columns = Object.keys(row);
    if (columns.some((c) => !/^[a-z_]+$/.test(c))) throw new Error('Invalid column');
    await this.run(
      `INSERT INTO ${table} (${columns.map((c) => `\`${c}\``).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      Object.values(row),
    );
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return fn();
    if (this.pool) {
      const connection = await this.pool.getConnection();
      try {
        await connection.beginTransaction();
        const callbacks: (() => void)[] = [];
        const result = await this.context.run(connection, () =>
          this.commitCallbacks.run(callbacks, fn),
        );
        await connection.commit();
        this.context.exit(() =>
          this.commitCallbacks.exit(() => callbacks.forEach((task) => task())),
        );
        return result;
      } catch (e) {
        await connection.rollback();
        throw e;
      } finally {
        connection.release();
      }
    }
    return this.locked(async () => {
      this.sqlite!.exec('BEGIN IMMEDIATE');
      try {
        const callbacks: (() => void)[] = [];
        const result = await this.context.run(true, () => this.commitCallbacks.run(callbacks, fn));
        this.sqlite!.exec('COMMIT');
        this.context.exit(() =>
          this.commitCallbacks.exit(() => callbacks.forEach((task) => task())),
        );
        return result;
      } catch (e) {
        this.sqlite!.exec('ROLLBACK');
        throw e;
      }
    });
  }
  afterCommit(task: () => void) {
    const callbacks = this.commitCallbacks.getStore();
    if (callbacks) callbacks.push(task);
    else this.context.exit(task);
  }
  private async ensureMissingColumns() {
    const columnMigrations: Array<[string, string, string]> = [
      ['chat_channels', 'team_id', 'VARCHAR(64)'],
      ['chat_channels', 'project_id', 'VARCHAR(64)'],
      ['chat_channels', 'description', 'TEXT'],
      ['chat_channels', 'updated_at', 'VARCHAR(32)'],
      ['chat_messages', 'reply_to_id', 'VARCHAR(64)'],
      ['chat_messages', 'forwarded_from', 'VARCHAR(100)'],
      ['chat_messages', 'edited', 'INTEGER NOT NULL DEFAULT 0'],
      ['chat_messages', 'attachments', 'TEXT'],
      ['chat_messages', 'pinned', 'INTEGER NOT NULL DEFAULT 0'],
      ['chat_messages', 'updated_at', 'VARCHAR(32)'],
      ['projects', 'visibility', "VARCHAR(20) NOT NULL DEFAULT 'workspace'"],
      ['projects', 'favorite', 'INTEGER NOT NULL DEFAULT 0'],
      ['projects', 'next_number', 'INTEGER NOT NULL DEFAULT 1'],
      ['projects', 'archived_at', 'VARCHAR(32)'],
      ['issues', 'start_date', 'VARCHAR(32)'],
      ['issues', 'flagged', 'INTEGER NOT NULL DEFAULT 0'],
      ['issues', 'carry_over', 'INTEGER NOT NULL DEFAULT 0'],
      ['issues', 'version', 'INTEGER NOT NULL DEFAULT 1'],
      ['issues', 'deleted_at', 'VARCHAR(32)'],
      ['comments', 'edited_at', 'VARCHAR(32)'],
      ['statuses', 'wip_limit', 'INTEGER NOT NULL DEFAULT 0'],
      ['sprints', 'committed_points', 'INTEGER NOT NULL DEFAULT 0'],
      ['sprints', 'completed_points', 'INTEGER NOT NULL DEFAULT 0'],
    ];

    const tableCols = new Map<string, Set<string>>();
    const uniqueTables = [...new Set(columnMigrations.map(([table]) => table))];
    for (const table of uniqueTables) {
      if (this.driver === 'sqlite') {
        const rows = await this.all<{ name: string }>(`PRAGMA table_info(${table})`);
        tableCols.set(table, new Set(rows.map((r) => r.name)));
      } else {
        const rows = await this.all<{ COLUMN_NAME: string }>(
          'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
          [table],
        );
        tableCols.set(table, new Set(rows.map((r) => r.COLUMN_NAME)));
      }
    }

    for (const [table, column, definition] of columnMigrations) {
      if (!tableCols.get(table)?.has(column)) {
        await this.run(`ALTER TABLE ${table} ADD COLUMN \`${column}\` ${definition}`);
        tableCols.get(table)?.add(column);
      }
    }

    await this.run("UPDATE chat_messages SET attachments = '[]' WHERE attachments IS NULL");
    await this.run(
      'UPDATE chat_messages SET updated_at = created_at WHERE updated_at IS NULL',
    );
    await this.run("UPDATE chat_channels SET description = '' WHERE description IS NULL");
    await this.run(
      'UPDATE chat_channels SET updated_at = created_at WHERE updated_at IS NULL',
    );
  }
  async migrate() {
    for (const [name, columns] of Object.entries(tables))
      await this.run(
        `CREATE TABLE IF NOT EXISTS ${name} (${columns})${this.driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : ''}`,
      );
    await this.ensureMissingColumns();
    for (const [name, table, columns] of indexes) {
      try {
        await this.run(
          `CREATE INDEX ${this.driver === 'sqlite' ? 'IF NOT EXISTS ' : ''}${name} ON ${table} (${columns})`,
        );
      } catch (e) {
        if ((e as { errno?: number }).errno !== 1061) throw e;
      }
    }
    if (!(await this.one('SELECT version FROM schema_migrations WHERE version = 1')))
      await this.insert('schema_migrations', {
        version: 1,
        applied_at: new Date().toISOString(),
      });
  }
  async close() {
    if (this.pool) await this.pool.end();
    else this.sqlite?.close();
  }
}
