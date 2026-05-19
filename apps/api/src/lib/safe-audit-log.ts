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
 * On schema drift (P2022/P2021) or RLS denial, logs a structured alert
 * and returns false — the business operation proceeds unaffected.
 *
 * BUG-222: Returns boolean to indicate success/failure for observability.
 */
export async function safeAuditLogCreate(
  db: Db,
  data: AuditLogCreateData,
): Promise<boolean> {
  try {
    await db.auditLog.create({ data });
    return true;
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
      // BUG-222: Detect RLS denial (Prisma P2010 or raw SQL 42501)
      const errMsg = err instanceof Error ? err.message : String(err);
      const isRlsDenial = errMsg.includes('row-level security') ||
        errMsg.includes('permission denied') ||
        errMsg.includes('new row violates row-level security policy');
      console.error(JSON.stringify({
        type: isRlsDenial ? 'audit_log_rls_denied' : 'audit_log_write_failed',
        operation: 'create',
        error: errMsg,
        action: (data as Record<string, unknown>).action ?? null,
        resource: (data as Record<string, unknown>).resource ?? null,
        ...(isRlsDenial && {
          guidance: 'Run migration 20260513_219_audit_logs_rls_service_role_forward.sql to grant access',
        }),
      }));
    }
    return false;
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
