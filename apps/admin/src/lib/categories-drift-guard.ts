/**
 * BUG-504-A06.5 admin category drift guard — React Query hook.
 *
 * Fetches `/api/v1/admin/categories` + `/api/v1/categories` in
 * parallel on every admin session that reads the category list, runs
 * the pure `detectCategoryDrift` diff, and — when drift is found —
 * fires `adminApi.settings.postAuditLog` with the event envelope
 * produced by `buildDriftEvent`.
 *
 * Consumed by:
 *   - `apps/admin/src/pages/settings.tsx:CategoriesTab`
 *   - `apps/admin/src/pages/products.tsx` (edit-product category dropdown)
 *
 * Query key is `['admin-categories']` — same as the pre-A06.5 key — so
 * existing `queryClient.invalidateQueries({ queryKey: ['admin-categories'] })`
 * calls in mutation handlers keep working unchanged.
 */
import { useQuery } from '@tanstack/react-query';
import {
  detectCategoryDrift,
  buildDriftEvent,
  type AdminCategory,
  type PublicCategory,
  type DriftReport,
} from '@cutebunny/shared/categories-drift-guard';
import { adminApi, API_BASE } from './api';

export interface AdminCategoriesWithDriftGuardResult {
  admin: AdminCategory[];
  report: DriftReport;
}

async function fetchPublicCategories(): Promise<PublicCategory[]> {
  // Public endpoint — no bearer, no credentials. Server returns the
  // visible taxonomy. A failure here must NOT cascade into a hard
  // error on the admin UI (admin can still operate without the drift
  // guard); we surface it as an empty public list, which suppresses
  // drift reporting for this fetch cycle.
  try {
    const res = await fetch(`${API_BASE}/api/v1/categories`);
    if (!res.ok) return [];
    const payload = (await res.json()) as { data?: PublicCategory[] };
    return payload.data ?? [];
  } catch {
    return [];
  }
}

export function useAdminCategoriesWithDriftGuard() {
  return useQuery<AdminCategoriesWithDriftGuardResult>({
    queryKey: ['admin-categories'],
    queryFn: async () => {
      const [adminResp, pub] = await Promise.all([
        adminApi.categories.list(),
        fetchPublicCategories(),
      ]);
      const admin = (adminResp.data ?? []) as AdminCategory[];
      const report = detectCategoryDrift({ admin, public: pub });

      if (report.hasDrift) {
        const event = buildDriftEvent(report, {
          detectedAt: new Date().toISOString(),
        });
        // Log locally first — persistence is best-effort. If the POST
        // fails (network, schema drift) the banner still renders.
        // eslint-disable-next-line no-console
        console.error('[BUG-504-A06.5] Category drift detected', event);
        adminApi.settings
          .postAuditLog({
            action: event.action,
            resource: event.resource,
            resource_id: event.resource_id,
            details: event.details as unknown as Record<string, unknown>,
          })
          .catch(() => {
            // Swallow — audit persistence is non-critical.
          });
      }

      return { admin, report };
    },
  });
}
