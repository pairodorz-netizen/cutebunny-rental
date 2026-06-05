-- Normalize color arrays to lowercase in products and combo_sets tables.
-- Fixes case-sensitivity mismatch between frontend filter keys (lowercase)
-- and DB values (mixed case entered via admin UI).

-- Products: lowercase every element in the color text[] column
UPDATE products
SET color = (
  SELECT array_agg(lower(elem))
  FROM unnest(color) AS elem
)
WHERE color IS NOT NULL
  AND color != '{}';

-- Combo sets: same normalization
UPDATE combo_sets
SET color = (
  SELECT array_agg(lower(elem))
  FROM unnest(color) AS elem
)
WHERE color IS NOT NULL
  AND color != '{}';
