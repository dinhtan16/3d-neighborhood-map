import { Client } from 'pg';
import { ADMIN_DB_URL, TEST_DB_NAME, TEST_DB_URL } from './test-env';
import { runMigrations } from '../src/database/migrate';
import { runSeed } from '../src/database/seeds/seed';

/** Recreate an isolated test database, apply migrations and seed it. */
export default async function globalSetup() {
  const admin = new Client({ connectionString: ADMIN_DB_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  const quiet = () => undefined;
  await runMigrations(TEST_DB_URL, quiet);
  await runSeed(TEST_DB_URL, quiet);
}
