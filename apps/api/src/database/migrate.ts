import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { readConfig } from '../config/env';

export const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/** Apply every pending *.sql migration in lexical order, each inside its own transaction. */
export async function runMigrations(databaseUrl: string, log: (m: string) => void = console.log): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    const { rows: existing } = await client.query(`SELECT to_regclass('public.schema_migrations') AS t, to_regclass('public.map_areas') AS a`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    if (!existing[0].t && existing[0].a) {
      // Schema 001 was applied by hand before the runner existed.
      await client.query(`INSERT INTO schema_migrations(name) VALUES ('001_init.sql') ON CONFLICT DO NOTHING`);
      log('Detected pre-existing schema; recorded 001_init.sql as applied');
    }
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      log(`Applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    if (!applied.length) log('Database is up to date');
    return applied;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations(readConfig().databaseUrl)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
