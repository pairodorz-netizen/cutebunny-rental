import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool } from '@neondatabase/serverless';
import { getEnv } from './env';

let prismaInstance: PrismaClient | null = null;

export function getDb(databaseUrl?: string): PrismaClient {
  if (prismaInstance) return prismaInstance;

  const env = getEnv();
  const connectionString = databaseUrl || env.DATABASE_URL;

  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);

  prismaInstance = new PrismaClient({ adapter } as never);

  return prismaInstance;
}

/**
 * Reset the Prisma instance (needed when env changes between Workers requests).
 */
export function resetDb(): void {
  prismaInstance = null;
}
