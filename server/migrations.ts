import type { Database } from './db.js';
import { now } from './seed.js';

/** Additive only: existing work, custom statuses and user-defined columns are preserved. */
export async function applyPlanningMigrations(db: Database) {
  await db.transaction(async () => {
    // Lock the existing migration row on MySQL so concurrent application starts serialize.
    await db.one(
      'SELECT version FROM schema_migrations WHERE version = 1' +
        (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
    );
    if (await db.one('SELECT version FROM schema_migrations WHERE version = 2')) return;
    const recordedAt = now();
    await db.run(
      'INSERT INTO planning_baselines (issue_id,workspace_id,project_id,sprint_id,status_id,story_points,deleted_at,recorded_at) SELECT id,workspace_id,project_id,sprint_id,status_id,story_points,deleted_at,? FROM issues',
      [recordedAt],
    );
    await db.insert('schema_migrations', { version: 2, applied_at: recordedAt });
  });
  await db.transaction(async () => {
    await db.one(
      'SELECT version FROM schema_migrations WHERE version = 1' +
        (db.driver === 'mysql' ? ' FOR UPDATE' : ''),
    );
    if (await db.one('SELECT version FROM schema_migrations WHERE version = 3')) return;
    // Closed-cycle snapshots start with observed completions; older results are never invented.
    await db.insert('schema_migrations', { version: 3, applied_at: now() });
  });
}
