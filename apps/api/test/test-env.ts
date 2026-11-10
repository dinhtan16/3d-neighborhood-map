export const ADMIN_DB_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
export const TEST_DB_NAME = 'neighborhood_map_test';
export const TEST_DB_URL = ADMIN_DB_URL.replace(/\/[^/]*$/, `/${TEST_DB_NAME}`);
