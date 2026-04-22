/**
 * BUG-504-A06.5 admin category drift guard — STUB (RED commit).
 *
 * This file is intentionally a stub on the RED commit. All exports
 * return a wrong-shape result so every assertion in
 * `apps/api/src/__tests__/bug504-a065-drift-guard.test.ts` fails
 * individually (not just the module-resolution failure).
 *
 * The GREEN commit replaces this stub with the real detector + event
 * builder. Do not ship this stub to prod — it would permanently show
 * the drift banner.
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
    label_mismatches: Array<{ slug: string; field: 'name_th' | 'name_en'; admin: string; public: string }>;
    admin_only_hidden: string[];
  };
}

/**
 * STUB: always reports drift=true with empty arrays. Real impl is in
 * the GREEN commit.
 */
export function detectCategoryDrift(_input: {
  admin: AdminCategory[];
  public: PublicCategory[];
}): DriftReport {
  return {
    hasDrift: true,
    missingInAdmin: [],
    labelMismatches: [],
    adminOnlyHidden: [],
  };
}

/**
 * STUB: returns an empty shell so the audit-payload assertion fails.
 */
export function buildDriftEvent(
  _report: DriftReport,
  _opts: { detectedAt: string },
): DriftEvent {
  return {
    action: 'category.drift_detected',
    resource: 'categories',
    resource_id: null,
    details: {
      detected_at: '',
      admin_slug_count: 0,
      public_slug_count: 0,
      missing_in_admin: [],
      label_mismatches: [],
      admin_only_hidden: [],
    },
  };
}
