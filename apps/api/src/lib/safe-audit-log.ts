/**
 * BUG-508 — Centralized audit log resilience wrapper.
 *
 * All audit log writes and reads go through these helpers so that
 * schema drift (e.g. audit_logs.ip_address type mismatch before
 * migration) degrades gracefully without blocking business operations.
 */

import { getDb } from './db';
import { isPrismaSchemaError, tagPrismaError } from './prisma-errors';

type Db = ReturnType<typeof getDb>;
type AuditLogCreateData = Parameters<Db['auditLog']['create']>[0]['data'];
type AuditLogFindManyArgs = Parameters<Db['auditLog']['findMany']>[0];

/**
 * Write an audit log entry without blocking the caller.
 * On schema drift (P2022/P2021), logs a structured alert and returns
 * silently — the business operation proceeds unaffected.
 */
export async function safeAuditLogCreate(
  db: Db,
  data: AuditLogCreateData,
): Promise<void> {
  try {
    await db.auditLog.create({ data });
  } catch (err) {
    if (isPrismaSchemaError(err)) {
      const tag = tagPrismaError(err);
      console.error(JSON.stringify({
        type: 'audit_logs_unavailable',
        operation: 'create',
        ...tag,
      }));
      // Detect ip_address-specific drift
      if (tag.column === 'ip_address' || tag.table === 'audit_logs') {
        console.error(JSON.stringify({
          type: 'schema_drift_detected',
          table: 'audit_logs',
          guidance: 'Run prisma migrate deploy to apply pending INET migration',
        }));
      }
    } else {
      // Non-schema error — still swallow to avoid blocking business ops
      console.error(JSON.stringify({
        type: 'audit_log_write_failed',
        operation: 'create',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }
}

export interface SafeAuditLogQueryResult<T> {
  data: T[];
  degraded: boolean;
}

/**
 * Query audit log entries with schema-drift resilience.
 * On P2022/P2021, returns empty array + degraded=true flag so the
 * caller can include `_meta.warning` in the response.
 */
export async function safeAuditLogQuery<T>(
  db: Db,
  args: AuditLogFindManyArgs,
): Promise<SafeAuditLogQueryResult<T>> {
  try {
    const rows = await db.auditLog.findMany(args);
    return { data: rows as T[], degraded: false };
  } catch (err) {
    if (isPrismaSchemaError(err)) {
      const tag = tagPrismaError(err);
      console.error(JSON.stringify({
        type: 'audit_logs_unavailable',
        operation: 'findMany',
        ...tag,
      }));
      if (tag.column === 'ip_address' || tag.table === 'audit_logs') {
        console.error(JSON.stringify({
          type: 'schema_drift_detected',
          table: 'audit_logs',
          guidance: 'Run prisma migrate deploy to apply pending INET migration',
        }));
      }
    } else {
      console.error(JSON.stringify({
        type: 'audit_log_query_failed',
        operation: 'findMany',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    return { data: [], degraded: true };
  }
}
