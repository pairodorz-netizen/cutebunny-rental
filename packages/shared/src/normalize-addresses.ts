/**
 * Backward-compatible address normalizer.
 *
 * Legacy: address JSONB is a single object (may contain metadata keys
 * like _shop_notes, line_id, birthday).
 * New format: array of address objects, each with a label.
 *
 * This normalizer converts legacy single-object to an array so
 * consumers always work with AddressEntry[].
 */

export interface AddressEntry {
  label?: string;
  recipient?: string;
  phone?: string;
  address?: string;
  district?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  [key: string]: unknown;
}

const META_KEYS = new Set([
  '_shop_notes',
  '_deleted_at',
  '_original_email',
  'line_id',
  'birthday',
]);

export function normalizeAddresses(raw: unknown): AddressEntry[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as AddressEntry[];
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const entry: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!META_KEYS.has(k)) entry[k] = v;
    }
    if (Object.keys(entry).length === 0) return [];
    return [{ label: 'ที่อยู่ 1', ...entry } as AddressEntry];
  }
  return [];
}
