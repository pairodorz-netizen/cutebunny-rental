/**
 * BUG-507 — One-shot PII backfill script.
 *
 * Masks existing audit_logs rows with ip_address older than 30 days,
 * and NULLs IPs older than 90 days.
 *
 * Usage:
 *   npx tsx scripts/pii_backfill.ts              # dry-run (default)
 *   npx tsx scripts/pii_backfill.ts --apply       # mutate database
 *
 * Dry-run outputs a summary of what WOULD change.
 * User must review dry-run output before running --apply.
 *
 * IMPORTANT: Do NOT run --apply on production without:
 *   1. Legal sign-off recorded in GitHub issue #151
 *   2. Human operator review of dry-run output
 */

// ---------------------------------------------------------------------------
// IP masking (inline to avoid import path issues in standalone script)
// ---------------------------------------------------------------------------

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_MAPPED_V6_RE = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

function maskIPv4(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

function expandIPv6(ip: string): string | null {
  const noZone = ip.split('%')[0];
  const halves = noZone.split('::');
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const groups = noZone.split(':');
    if (groups.length !== 8) return null;
    if (!groups.every((g) => g.length >= 1 && g.length <= 4 && /^[0-9a-fA-F]+$/.test(g))) return null;
    return groups.map((g) => g.padStart(4, '0')).join(':');
  }
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  const isHex = (g: string) => g.length >= 1 && g.length <= 4 && /^[0-9a-fA-F]+$/.test(g);
  if (!left.every(isHex) || !right.every(isHex)) return null;
  return [...left.map((g) => g.padStart(4, '0')), ...Array(fill).fill('0000'), ...right.map((g) => g.padStart(4, '0'))].join(':');
}

function maskIPv6(ip: string): string | null {
  const expanded = expandIPv6(ip);
  if (!expanded) return null;
  const groups = expanded.split(':');
  if (groups.length !== 8) return null;
  return `${groups[0]}:${groups[1]}:${groups[2]}::/48`;
}

function maskIP(ip: string | null | undefined): string | null {
  if (!ip || typeof ip !== 'string') return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  const mapped = trimmed.match(IPV4_MAPPED_V6_RE);
  if (mapped) return maskIPv4(mapped[1]);
  if (IPV4_RE.test(trimmed)) return maskIPv4(trimmed);
  if (trimmed.includes(':')) return maskIPv6(trimmed);
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface BackfillRow {
  id: string;
  ip_address: string;
  created_at: Date;
}

interface BackfillResult {
  dry_run: boolean;
  to_mask: Array<{ id: string; original: string; masked: string | null; age_days: number }>;
  to_delete: Array<{ id: string; age_days: number }>;
  applied: boolean;
  masked_count: number;
  deleted_count: number;
}

async function main() {
  const applyMode = process.argv.includes('--apply');
  const now = new Date();
  const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day90Ago = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  console.log('=== BUG-507 PII Backfill ===');
  console.log(`Mode: ${applyMode ? 'APPLY (will mutate)' : 'DRY-RUN (read-only)'}`);
  console.log(`Now: ${now.toISOString()}`);
  console.log(`30-day cutoff: ${day30Ago.toISOString()}`);
  console.log(`90-day cutoff: ${day90Ago.toISOString()}`);
  console.log('');

  // This script requires DATABASE_URL to be set
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required.');
    console.error('Set it before running: export DATABASE_URL="postgresql://..."');
    process.exit(1);
  }

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const result: BackfillResult = {
      dry_run: !applyMode,
      to_mask: [],
      to_delete: [],
      applied: false,
      masked_count: 0,
      deleted_count: 0,
    };

    // Find rows to mask (30–90 days old, ip_address not NULL, not already masked)
    const maskRows = await prisma.$queryRawUnsafe<BackfillRow[]>(
      `SELECT id, host(ip_address)::text AS ip_address, created_at
       FROM audit_logs
       WHERE created_at <= $1
         AND created_at > $2
         AND ip_address IS NOT NULL
       ORDER BY created_at DESC`,
      day30Ago,
      day90Ago,
    );

    for (const row of maskRows) {
      const ageDays = Math.floor((now.getTime() - new Date(row.created_at).getTime()) / (24 * 60 * 60 * 1000));
      const masked = maskIP(row.ip_address);
      // Skip if already masked (ends in .0 or /24 or /48)
      if (row.ip_address.endsWith('.0') || row.ip_address.includes('/24') || row.ip_address.includes('/48')) {
        continue;
      }
      result.to_mask.push({
        id: row.id,
        original: row.ip_address,
        masked,
        age_days: ageDays,
      });
    }

    // Find rows to delete (>90 days old, ip_address not NULL)
    const deleteRows = await prisma.$queryRawUnsafe<BackfillRow[]>(
      `SELECT id, host(ip_address)::text AS ip_address, created_at
       FROM audit_logs
       WHERE created_at <= $1
         AND ip_address IS NOT NULL
       ORDER BY created_at DESC`,
      day90Ago,
    );

    for (const row of deleteRows) {
      const ageDays = Math.floor((now.getTime() - new Date(row.created_at).getTime()) / (24 * 60 * 60 * 1000));
      result.to_delete.push({ id: row.id, age_days: ageDays });
    }

    // Print summary
    console.log(`Rows to MASK (30-90d): ${result.to_mask.length}`);
    for (const r of result.to_mask.slice(0, 20)) {
      console.log(`  ${r.id} | ${r.age_days}d | ${r.original} → ${r.masked}`);
    }
    if (result.to_mask.length > 20) {
      console.log(`  ... and ${result.to_mask.length - 20} more`);
    }

    console.log('');
    console.log(`Rows to DELETE IP (>90d): ${result.to_delete.length}`);
    for (const r of result.to_delete.slice(0, 20)) {
      console.log(`  ${r.id} | ${r.age_days}d`);
    }
    if (result.to_delete.length > 20) {
      console.log(`  ... and ${result.to_delete.length - 20} more`);
    }

    // Apply if --apply flag
    if (applyMode) {
      console.log('');
      console.log('Applying changes...');

      for (const r of result.to_mask) {
        if (r.masked) {
          await prisma.$executeRawUnsafe(
            `UPDATE audit_logs SET ip_address = $1::inet WHERE id = $2::uuid`,
            r.masked,
            r.id,
          );
        } else {
          await prisma.$executeRawUnsafe(
            `UPDATE audit_logs SET ip_address = NULL WHERE id = $1::uuid`,
            r.id,
          );
        }
        result.masked_count++;
      }

      for (const r of result.to_delete) {
        await prisma.$executeRawUnsafe(
          `UPDATE audit_logs SET ip_address = NULL WHERE id = $1::uuid`,
          r.id,
        );
        result.deleted_count++;
      }

      result.applied = true;
      console.log(`Masked: ${result.masked_count}, Deleted: ${result.deleted_count}`);
    } else {
      console.log('');
      console.log('DRY-RUN complete. To apply changes, run:');
      console.log('  npx tsx scripts/pii_backfill.ts --apply');
      console.log('');
      console.log('⚠ Review output above before running --apply on production.');
      console.log('⚠ Legal sign-off required (issue #151) before production backfill.');
    }

    console.log('');
    console.log('Result:', JSON.stringify({
      dry_run: result.dry_run,
      to_mask_count: result.to_mask.length,
      to_delete_count: result.to_delete.length,
      applied: result.applied,
      masked_count: result.masked_count,
      deleted_count: result.deleted_count,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
