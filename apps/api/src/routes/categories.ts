import { Hono } from 'hono';
import { getDb } from '../lib/db';
import { success, error } from '../lib/response';

// BUG-504-A02 — public product-taxonomy read endpoint.
//
// Single source of truth feeding the upcoming A03 admin Settings→
// Categories CRUD UI and the A04 customer category filter. The payload
// is snake_case at the API boundary (matching the underlying DB
// columns + what admin/customer already send over the wire elsewhere)
// so Prisma's camelCase field names never leak.
//
// Non-goals:
//   • No auth — this is public, non-PII, non-credential metadata. A03
//     will consume the same endpoint; it sees the same `visible_backend`
//     flag customer would simply ignore. Dedicated admin routes would
//     duplicate the model for no security gain.
//   • No filtering — raw dump; customer filters client-side on
//     `visible_frontend`, admin renders everything.
//   • No FK writes, no Product.category mutation.
const categories = new Hono();

// Cache for 30 seconds at both browser and Cloudflare edge.
//
// BUG-505-A01: dropped from 300s → 30s because the 5-min edge TTL
// produced a drift-banner false-positive on every admin category
// mutation: admin's no-cache list refetched immediately, but the
// drift-guard's parallel `/api/v1/categories` fetch was served from
// edge cache for up to 5 min after the mutation, so
// `detectCategoryDrift` reported `missingInAdmin = [<just-deleted>]`
// until the TTL rolled over. 30s is below the human-perception
// threshold of "I clicked delete and the page eventually updated"
// while still bounding DB read load on the public endpoint (≤10
// rows; query is `findMany ORDER BY sort_order` on an indexed
// table). Re-evaluate if customer traffic on this route becomes a
// hot-path.
const CACHE_CONTROL = 'public, max-age=30, s-maxage=30';

// GET /api/v1/categories — ordered list of product categories.
categories.get('/', async (c) => {
  try {
    const db = getDb();
    const rows = await db.category.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    const data = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name_th: row.nameTh,
      name_en: row.nameEn,
      sort_order: row.sortOrder,
      visible_frontend: row.visibleFrontend,
      visible_backend: row.visibleBackend,
    }));

    c.header('Cache-Control', CACHE_CONTROL);
    return success(c, data);
  } catch {
    // Redacted envelope — no DB text, no stack, no message leak.
    // Matches BUG-404-A01 / BUG-405-A01 baseline.
    return error(c, 500, 'internal_error', 'Unexpected server error');
  }
});

export default categories;
