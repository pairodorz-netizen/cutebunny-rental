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

// Cache for 5 minutes at both browser and Cloudflare edge. The 7-row
// payload is stable day-to-day; A03 CRUD edits will be eventually
// consistent within 300s which matches the ratified spec.
const CACHE_CONTROL = 'public, max-age=300, s-maxage=300';

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
