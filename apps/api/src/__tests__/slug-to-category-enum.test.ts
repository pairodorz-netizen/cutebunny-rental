/**
 * slugToCategoryEnum — unit tests for the legacy enum resolver.
 *
 * Covers the override map that handles slugs whose Prisma enum
 * identifier is NOT a simple hyphen-to-underscore transform
 * (e.g. `vietnamese-dress` → `vietnam`).
 */

import { describe, it, expect } from 'vitest';
import { slugToCategoryEnum } from '../routes/admin/products';

describe('slugToCategoryEnum', () => {
  it('converts hyphenated slugs to underscored enum identifiers', () => {
    expect(slugToCategoryEnum('ig-looks')).toBe('ig_looks');
    expect(slugToCategoryEnum('travel-looks')).toBe('travel_looks');
  });

  it('passes through non-hyphenated slugs unchanged', () => {
    expect(slugToCategoryEnum('dress')).toBe('dress');
    expect(slugToCategoryEnum('bikini')).toBe('bikini');
    expect(slugToCategoryEnum('camera')).toBe('camera');
  });

  it('maps vietnamese-dress to vietnam via override', () => {
    expect(slugToCategoryEnum('vietnamese-dress')).toBe('vietnam');
  });

  it('covers all 6 live category slugs without error', () => {
    const liveSlugs = ['ig-looks', 'dress', 'bikini', 'travel-looks', 'vietnamese-dress', 'camera'];
    const expected = ['ig_looks', 'dress', 'bikini', 'travel_looks', 'vietnam', 'camera'];
    liveSlugs.forEach((slug, i) => {
      expect(slugToCategoryEnum(slug)).toBe(expected[i]);
    });
  });
});
