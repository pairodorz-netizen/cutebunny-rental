/**
 * Environment variable validation.
 * Fail fast at startup if required variables are missing.
 */

interface EnvConfig {
  DATABASE_URL: string;
  JWT_SECRET: string;
  PORT: number;
  NODE_ENV: string;
}

const REQUIRED_VARS = ['DATABASE_URL'] as const;

const WARNINGS = {
  JWT_SECRET: 'Using default JWT secret — change this in production!',
} as const;

export function validateEnv(): EnvConfig {
  const missing: string[] = [];

  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.error(`\n  FATAL: Missing required environment variables:\n`);
    for (const key of missing) {
      console.error(`    - ${key}`);
    }
    console.error(`\n  Copy .env.example to .env and fill in the values.\n`);
    process.exit(1);
  }

  // Warnings for non-critical defaults
  const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  if (jwtSecret === 'dev-secret-change-in-production' && process.env.NODE_ENV === 'production') {
    console.warn(`  WARNING: ${WARNINGS.JWT_SECRET}`);
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    JWT_SECRET: jwtSecret,
    PORT: parseInt(process.env.PORT ?? '3001', 10),
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  };
}
