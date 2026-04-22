/**
 * BUG-504-A06.5 admin category drift guard — pure detector + event builder.
 *
 * Context: owner observed prod admin UI rendering category labels that
 * disagree with the public source of truth (public /api/v1/categories
 * returns wedding/evening/…; admin UI rendered Instagram Brand /
 * Cafe Outfit / Bikini / …). Root cause could not be bearer-verified
 * in the browser — BUG-504-A07 will mint an admin CI bearer so
 * Playwright can assert admin-side parity. Until then, this module
 * runs client-side on every admin session that reads
 * /api/v1/admin/categories: it fetches /api/v1/categories in parallel
 * and surfaces a banner + audit-log event when the two disagree on
 * the visible intersection.
 *
 * Semantics (per owner ack 2026-04-22):
 *   - Drift = a public slug missing from the admin response, or a
 *     label mismatch (name_th / name_en) on a slug present in both.
 *   - Hidden-only admin rows (visible_frontend=false and absent from
 *     public) are NOT drift. They are surfaced separately as
 *     `adminOnlyHidden` for observability but do not set `hasDrift=true`.
 *
 * Framework-free: no React / no DOM / no fetch. Both the hook in
 * `apps/admin/src/lib/categories-drift-guard.ts` and the vitest gates
 * in `apps/api/src/__tests__/bug504-a065-drift-guard.test.ts` consume
 * these pure functions.
 */

export interface AdminCategory {
  id: string;
  slug: string;
  name_th: string;
  name_en: string;
  sort_order: number;
  visible_frontend: boolean;
  visible_backend: boolean;
}

export interface PublicCategory {
  slug: string;
  name_th: string;
  name_en: string;
  sort_order: number;
}

export interface LabelMismatch {
  slug: string;
  field: 'name_th' | 'name_en';
  admin: string;
  public: string;
}

export interface DriftReport {
  hasDrift: boolean;
  adminCount: number;
  publicCount: number;
  missingInAdmin: PublicCategory[];
  labelMismatches: LabelMismatch[];
  adminOnlyHidden: AdminCategory[];
}

export interface DriftEvent {
  action: 'category.drift_detected';
  resource: 'categories';
  resource_id: null;
  details: {
    detected_at: string;
    admin_slug_count: number;
    public_slug_count: number;
    missing_in_admin: string[];
    label_mismatches: LabelMismatch[];
    admin_only_hidden: string[];
  };
}

/**
 * Diffs an admin `/api/v1/admin/categories` response against the
 * public `/api/v1/categories` response. Pure: no side effects.
 *
 * Invariants:
 *   - `hasDrift` is true iff `missingInAdmin` OR `labelMismatches` is
 *     non-empty. `adminOnlyHidden` never contributes to hasDrift.
 *   - `missingInAdmin` is ordered by `public.sort_order` ASC (stable
 *     against the caller's input order).
 *   - `labelMismatches` reports both fields (name_th + name_en) if
 *     both differ for a given slug, as two entries.
 */
export function detectCategoryDrift(input: {
  admin: AdminCategory[];
  public: PublicCategory[];
}): DriftReport {
  const { admin, public: pub } = input;
  const adminMap = new Map(admin.map((c) => [c.slug, c]));
  const publicMap = new Map(pub.map((c) => [c.slug, c]));

  // Stable order: iterate public in its given order (caller is
  // expected to pass sort_order ASC; we do not re-sort here).
  const missingInAdmin: PublicCategory[] = pub.filter(
    (p) => !adminMap.has(p.slug),
  );

  const labelMismatches: LabelMismatch[] = [];
  for (const p of pub) {
    const a = adminMap.get(p.slug);
    if (!a) continue;
    if (a.name_th !== p.name_th) {
      labelMismatches.push({
        slug: p.slug,
        field: 'name_th',
        admin: a.name_th,
        public: p.name_th,
      });
    }
    if (a.name_en !== p.name_en) {
      labelMismatches.push({
        slug: p.slug,
        field: 'name_en',
        admin: a.name_en,
        public: p.name_en,
      });
    }
  }

  const adminOnlyHidden: AdminCategory[] = admin.filter(
    (c) => !c.visible_frontend && !publicMap.has(c.slug),
  );

  const hasDrift = missingInAdmin.length > 0 || labelMismatches.length > 0;

  return {
    hasDrift,
    adminCount: admin.length,
    publicCount: pub.length,
    missingInAdmin,
    labelMismatches,
    adminOnlyHidden,
  };
}

/**
 * Builds the audit-log payload for a detected drift. Matches the
 * envelope shape consumed by the existing admin audit-log endpoint
 * (see `apps/admin/src/lib/api.ts:916-918`): top-level `action` /
 * `resource` / `resource_id` / `details`.
 */
export function buildDriftEvent(
  report: DriftReport,
  opts: { detectedAt: string },
): DriftEvent {
  return {
    action: 'category.drift_detected',
    resource: 'categories',
    resource_id: null,
    details: {
      detected_at: opts.detectedAt,
      admin_slug_count: report.adminCount,
      public_slug_count: report.publicCount,
      missing_in_admin: report.missingInAdmin.map((c) => c.slug),
      label_mismatches: report.labelMismatches,
      admin_only_hidden: report.adminOnlyHidden.map((c) => c.slug),
    },
  };
}
