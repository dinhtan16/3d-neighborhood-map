import * as path from 'path';
import * as dotenv from 'dotenv';

/** apps/api/src/config -> repo root (same depth from dist/config). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
export const API_ROOT = path.resolve(__dirname, '..', '..');

let loaded = false;

/** Load repo-root .env then apps/api/.env. Existing process.env values always win. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true } as dotenv.DotenvConfigOptions);
  dotenv.config({ path: path.join(API_ROOT, '.env'), quiet: true } as dotenv.DotenvConfigOptions);
}

export interface AppConfig {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  adminEmail: string;
  adminPassword: string;
  jwtSecret: string;
  jwtExpiresInSec: number;
  storagePublicBaseUrl: string;
  storageLocalDir: string;
  importerPython: string;
  rateLimitPerMin: number;
  searchRateLimitPerMin: number;
}

export function readConfig(): AppConfig {
  loadEnv();
  const env = process.env;
  const storageLocalDir = env.STORAGE_LOCAL_DIR ?? './storage';
  return {
    port: Number(env.API_PORT ?? 4000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/neighborhood_map',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    adminEmail: env.ADMIN_EMAIL ?? 'admin@example.com',
    adminPassword: env.ADMIN_PASSWORD ?? 'change-me',
    jwtSecret: env.JWT_SECRET ?? 'dev-only-insecure-secret',
    jwtExpiresInSec: 12 * 3600,
    storagePublicBaseUrl: (env.STORAGE_PUBLIC_BASE_URL ?? 'http://localhost:4000/static').replace(/\/+$/, ''),
    storageLocalDir: path.isAbsolute(storageLocalDir) ? storageLocalDir : path.resolve(REPO_ROOT, storageLocalDir),
    importerPython: env.IMPORTER_PYTHON ?? 'python3',
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN ?? 120),
    searchRateLimitPerMin: Number(env.SEARCH_RATE_LIMIT_PER_MIN ?? 60),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
