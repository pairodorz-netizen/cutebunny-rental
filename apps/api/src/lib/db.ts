import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient | null = null;

export function getDb(databaseUrl?: string): PrismaClient {
  if (prismaInstance) return prismaInstance;

  prismaInstance = new PrismaClient({
    datasourceUrl: databaseUrl || process.env.DATABASE_URL,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  return prismaInstance;
}
