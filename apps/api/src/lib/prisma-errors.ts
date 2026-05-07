/**
 * BUG-506 — Prisma error detection helpers.
 *
 * Provides structured error tagging for Workers-side observability.
 * P2022 = "The column X does not exist in the current database" — schema drift.
 */

/** Check if an error is a Prisma P2022 (column does not exist). */
export function isPrismaP2022(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code: string }).code === 'P2022';
  }
  if (err instanceof Error) {
    return err.message.includes('does not exist in the current database');
  }
  return false;
}

/** Check if an error is any Prisma schema-drift error (P2022 column missing, P2021 table missing). */
export function isPrismaSchemaError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: string }).code;
    return code === 'P2022' || code === 'P2021';
  }
  if (err instanceof Error) {
    return (
      err.message.includes('does not exist in the current database') ||
      err.message.includes('does not exist in the current schema')
    );
  }
  return false;
}

interface PrismaErrorTag {
  tag: 'prisma_p2022' | 'prisma_p2021' | 'prisma_unknown';
  code: string;
  message: string;
  table?: string;
  column?: string;
}

/** Extract structured tag from a Prisma error for Workers observability. */
export function tagPrismaError(err: unknown): PrismaErrorTag {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: string }).code)
      : 'unknown';
  const message = err instanceof Error ? err.message : String(err);

  // Extract table.column from message like "The column `audit_logs.ip_address` does not exist"
  const colMatch = message.match(/column\s+[`"]?(\w+)\.(\w+)[`"]?/i);

  if (code === 'P2022' || message.includes('does not exist in the current database')) {
    return {
      tag: 'prisma_p2022',
      code: 'P2022',
      message,
      table: colMatch?.[1],
      column: colMatch?.[2],
    };
  }

  if (code === 'P2021') {
    return {
      tag: 'prisma_p2021',
      code: 'P2021',
      message,
      table: colMatch?.[1],
    };
  }

  return { tag: 'prisma_unknown', code, message };
}
