/**
 * Environment variable handling for Cloudflare Workers.
 * Workers don't have process.env — env vars come from wrangler secrets/vars
 * and are accessed via Hono's c.env bindings.
 */

export interface Env {
  DATABASE_URL: string;
  DIRECT_URL?: string;
  JWT_SECRET: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ENVIRONMENT?: string;
  NODE_ENV?: string;
  PORT?: string;
}

// Global env store — set once per request via middleware
let _env: Env | null = null;

export function setEnv(env: Env): void {
  _env = env;
}

export function getEnv(): Env {
  if (!_env) {
    // Fallback to process.env for local dev (node-server)
    if (typeof process !== 'undefined' && process.env) {
      return {
        DATABASE_URL: process.env.DATABASE_URL ?? '',
        DIRECT_URL: process.env.DIRECT_URL,
        JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
        ENVIRONMENT: process.env.ENVIRONMENT ?? 'development',
        NODE_ENV: process.env.NODE_ENV ?? 'development',
        PORT: process.env.PORT ?? '3001',
      };
    }
    throw new Error('Environment not initialized. Call setEnv() first.');
  }
  return _env;
}

/**
 * Legacy validateEnv for local node-server usage (server.ts).
 */
export function validateEnv() {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    console.error('\n  FATAL: Missing required DATABASE_URL\n');
    if (typeof process !== 'undefined') process.exit(1);
  }
  return {
    DATABASE_URL: env.DATABASE_URL,
    JWT_SECRET: env.JWT_SECRET || 'dev-secret-change-in-production',
    PORT: parseInt(env.PORT ?? '3001', 10),
    NODE_ENV: env.NODE_ENV ?? 'development',
  };
}
