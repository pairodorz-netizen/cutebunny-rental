/**
 * BUG-504-A06.5 admin category drift guard — RED gates.
 *
 * Context (owner flagged 2026-04-22):
 *   Prod admin UI renders category labels that disagree with the DB
 *   source of truth (public /api/v1/categories returns wedding/evening/
 *   …/accessories; admin UI renders Instagram Brand / Cafe Outfit /
 *   Bikini / …). Root cause not yet bearer-verifiable (owner cannot
 *   mint ADMIN_JWT_PROD from browser; follow-up ticket
 *   BUG-504-A07-gate7-admin-ci-token queued).
 *
 *   Rather than speculate about the root cause, A06.5 adds a
 *   client-side cross-endpoint drift guard: every admin session that
 *   reads /api/v1/admin/categories ALSO reads /api/v1/categories in
 *   parallel, diffs the two, and surfaces a <DriftBanner/> + audit
 *   event when they disagree on the intersection (= visible rows).
 *
 * This file asserts the pure-logic detector (`detectCategoryDrift` +
 * `buildDriftEvent`) that drives the banner + audit payload. Both live
 * in `packages/shared/src/categories-drift-guard.ts` so they are
 * framework-free and testable from node vitest (no DOM, no React).
 *
 * RED expectation: this file imports a module that does NOT EXIST on
 * the RED commit. All five gates fail at module-resolution time. The
 * GREEN commit adds `packages/shared/src/categories-drift-guard.ts`
 * with the pure detector + event builder, re-exports them from
 * `@cutebunny/shared`, and flips all five gates to green simultaneously.
 *
 * Owner-spec gate layout (see chat 2026-04-22 "A06.5 scope"):
 *   1. parity input → hasDrift=false
 *   2. admin missing a public slug → hasDrift=true, structured diff
 *   3. label mismatch on common slug → hasDrift=true, structured diff
 *   4. admin-only hidden row (visible_frontend=false absent from public)
 *      → NOT drift (hidden rows are expected to be admin-only)
 *   5. buildDriftEvent(report) returns audit-payload shape for POST
 *      /api/v1/admin/settings/audit-log (matches existing auditLog
 *      endpoint shape in apps/admin/src/lib/api.ts:916-918).
 *
 * A Playwright leg is intentionally deferred to BUG-504-A07 because
 * the admin banner only renders behind login (no CI-safe bearer yet).
 * The A05 customer↔API parity spec already covers the public side.
 */
import { describe, it, expect } from 'vitest';
import {
  detectCategoryDrift,
  buildDriftEvent,
  type AdminCategory,
  type PublicCategory,
  type DriftReport,
} from '@cutebunny/shared/categories-drift-guard';

const seededAdmin: AdminCategory[] = [
  { id: '00000000-0000-0000-0000-000000000001', slug: 'wedding', name_th: 'ชุดแต่งงาน', name_en: 'Wedding', sort_order: 1, visible_frontend: true, visible_backend: true },
  { id: '00000000-0000-0000-0000-000000000002', slug: 'evening', name_th: 'ชุดราตรี', name_en: 'Evening', sort_order: 2, visible_frontend: true, visible_backend: true },
  { id: '00000000-0000-0000-0000-000000000003', slug: 'cocktail', name_th: 'ค็อกเทล', name_en: 'Cocktail', sort_order: 3, visible_frontend: true, visible_backend: true },
  { id: '00000000-0000-0000-0000-000000000004', slug: 'casual', name_th: 'ชุดลำลอง', name_en: 'Casual', sort_order: 4, visible_frontend: true, visible_backend: true },
  { id: '00000000-0000-0000-0000-000000000005', slug: 'costume', name_th: 'ชุดแฟนซี', name_en: 'Costume', sort_order: 5, visible_frontend: true, visible_backend: true },
  { id: '00000000-0000-0000-0000-000000000006', slug: 'traditional', name_th: 'ชุดไทย', name_en: 'Traditional', sort_order: 6, visible_frontend: true, visible_backend: true },
  { id: '00000000-0000-0000-0000-000000000007', slug: 'accessories', name_th: 'เครื่องประดับ', name_en: 'Accessories', sort_order: 7, visible_frontend: true, visible_backend: true },
];

const seededPublic: PublicCategory[] = seededAdmin.map((c) => ({
  slug: c.slug,
  name_th: c.name_th,
  name_en: c.name_en,
  sort_order: c.sort_order,
}));

describe('BUG-504-A06.5 detectCategoryDrift — pure logic', () => {
  it('gate 1 — returns hasDrift=false on exact parity (admin == public intersection)', () => {
    const report: DriftReport = detectCategoryDrift({ admin: seededAdmin, public: seededPublic });
    expect(report.hasDrift).toBe(false);
    expect(report.missingInAdmin).toEqual([]);
    expect(report.labelMismatches).toEqual([]);
    expect(report.adminOnlyHidden).toEqual([]);
  });

  it('gate 2 — detects a slug the public exposes but the admin response omits', () => {
    // Admin response drops `wedding` (simulates the observed drift:
    // admin is reading a stale/different source than the public SoT).
    const adminMissingWedding = seededAdmin.filter((c) => c.slug !== 'wedding');
    const report = detectCategoryDrift({ admin: adminMissingWedding, public: seededPublic });
    expect(report.hasDrift).toBe(true);
    expect(report.missingInAdmin.map((x) => x.slug)).toEqual(['wedding']);
    // Intersection labels still match → no label mismatches reported
    expect(report.labelMismatches).toEqual([]);
  });

  it('gate 3 — detects label mismatch on a common slug (th or en differs)', () => {
    // Admin response renames `casual` → "Instagram Brand" (mirrors
    // the exact string the owner reported seeing in prod).
    const adminMislabelled: AdminCategory[] = seededAdmin.map((c) =>
      c.slug === 'casual' ? { ...c, name_en: 'Instagram Brand' } : c,
    );
    const report = detectCategoryDrift({ admin: adminMislabelled, public: seededPublic });
    expect(report.hasDrift).toBe(true);
    expect(report.missingInAdmin).toEqual([]);
    expect(report.labelMismatches).toEqual([
      {
        slug: 'casual',
        field: 'name_en',
        admin: 'Instagram Brand',
        public: 'Casual',
      },
    ]);
  });

  it('gate 4 — admin-only hidden rows (visible_frontend=false, absent from public) are NOT drift', () => {
    // A staff-only category like `wholesale` lives in admin with
    // visible_frontend=false. Public endpoint (A02) filters it out.
    // This is intended behavior, must not trigger the banner.
    const adminWithHidden: AdminCategory[] = [
      ...seededAdmin,
      {
        id: '00000000-0000-0000-0000-000000000099',
        slug: 'wholesale',
        name_th: 'ขายส่ง',
        name_en: 'Wholesale',
        sort_order: 99,
        visible_frontend: false,
        visible_backend: true,
      },
    ];
    const report = detectCategoryDrift({ admin: adminWithHidden, public: seededPublic });
    expect(report.hasDrift).toBe(false);
    expect(report.missingInAdmin).toEqual([]);
    expect(report.labelMismatches).toEqual([]);
    // Hidden-only rows are surfaced separately for observability but
    // do NOT contribute to hasDrift.
    expect(report.adminOnlyHidden.map((x) => x.slug)).toEqual(['wholesale']);
  });

  it('gate 5 — buildDriftEvent produces the exact audit-log payload shape', () => {
    const adminMissingWedding = seededAdmin.filter((c) => c.slug !== 'wedding');
    const report = detectCategoryDrift({ admin: adminMissingWedding, public: seededPublic });
    const event = buildDriftEvent(report, { detectedAt: '2026-04-22T14:00:00.000Z' });
    // Must match the existing admin audit-log envelope shape (see
    // apps/admin/src/lib/api.ts:916-918 — action/resource/details).
    expect(event).toEqual({
      action: 'category.drift_detected',
      resource: 'categories',
      resource_id: null,
      details: {
        detected_at: '2026-04-22T14:00:00.000Z',
        admin_slug_count: 6,
        public_slug_count: 7,
        missing_in_admin: ['wedding'],
        label_mismatches: [],
        admin_only_hidden: [],
      },
    });
  });
});
