import { TEST_DB_URL } from './test-env';

process.env.DATABASE_URL = TEST_DB_URL;
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.JWT_SECRET = 'test-secret-for-jest-only';
process.env.RATE_LIMIT_PER_MIN = '10000';
process.env.SEARCH_RATE_LIMIT_PER_MIN = '10000';
process.env.STORAGE_LOCAL_DIR = '/tmp/nmap-api-test-storage';
