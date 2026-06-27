/**
 * Mock calendar dataset for e2e testing.
 * Contains 7 dresses, each with a different primary status on
 * today's date, covering all 7 SlotState values.
 *
 * Used by calendar-mobile.spec.ts via Playwright route interception
 * — does NOT change production data fetching.
 */

interface MockSlot {
  date: string;
  status: string;
  order_id: string | null;
}

interface MockCalendarRow {
  product_id: string;
  unit_id: string | null;
  unit_index: number;
  sku: string;
  name: string;
  display_name: string;
  brand: string | null;
  category: string;
  thumbnail: string | null;
  stock_on_hand: number;
  slots: MockSlot[];
}

/**
 * Generate today's date as YYYY-MM-DD, plus a few surrounding dates
 * for DayStrip testing. Dates are generated relative to a given
 * month start (YYYY-MM-01) so they align with the calendar's month.
 */
function getTestDates(monthStart: string): string[] {
  const [y, m] = monthStart.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return dates;
}

/**
 * Build the mock dataset. Accepts the month start date so slot dates
 * align with the calendar's current month view.
 */
export function buildCalendarMockData(monthStart: string): MockCalendarRow[] {
  const dates = getTestDates(monthStart);
  const today = new Date().toISOString().split('T')[0];
  // Use today if it's in the current month, otherwise use the 15th
  const targetDate = dates.includes(today) ? today : dates[14] ?? dates[0];

  const statuses = [
    'available',
    'booked',
    'blocked_repair',
    'late_return',
    'tentative',
    'shipping',
    'washing',
  ] as const;

  const dressNames = [
    { name: 'Sakura Blossom', brand: 'CuteBunny', sku: 'CB-SAK-001' },
    { name: 'Moonlight Serenade', brand: 'CuteBunny', sku: 'CB-MON-002' },
    { name: 'Rose Petal Dream', brand: 'Fairy Tale', sku: 'FT-ROS-003' },
    { name: 'Crystal Frost', brand: 'Fairy Tale', sku: 'FT-CRY-004' },
    { name: 'Golden Sunset', brand: 'CuteBunny', sku: 'CB-GOL-005' },
    { name: 'Starlight Waltz', brand: 'Dreamer', sku: 'DR-STA-006' },
    { name: 'Velvet Midnight', brand: 'Dreamer', sku: 'DR-VEL-007' },
  ];

  return dressNames.map((dress, i) => {
    const status = statuses[i];
    // Generate slots for all dates in the month
    const slots: MockSlot[] = dates.map((date) => ({
      date,
      // The target date gets the assigned status; others get 'available'
      status: date === targetDate ? status : 'available',
      order_id: date === targetDate && status === 'booked' ? 'order-mock-001' : null,
    }));

    return {
      product_id: `prod-${i + 1}`,
      unit_id: `unit-${i + 1}`,
      unit_index: 0,
      sku: dress.sku,
      name: dress.name,
      display_name: dress.name,
      brand: dress.brand,
      category: 'Evening Dress',
      thumbnail: null,
      stock_on_hand: 1,
      slots,
    };
  });
}

/**
 * A multi-unit product for testing #N suffix rendering.
 * Stock = 3 → 3 rows: "Aurora Glow", "Aurora Glow #2", "Aurora Glow #3"
 */
export function buildMultiUnitRow(monthStart: string): MockCalendarRow[] {
  const dates = getTestDates(monthStart);
  return [0, 1, 2].map((idx) => ({
    product_id: 'prod-multi',
    unit_id: `unit-multi-${idx}`,
    unit_index: idx,
    sku: 'CB-AUR-008',
    name: 'Aurora Glow',
    display_name: idx === 0 ? 'Aurora Glow' : `Aurora Glow #${idx + 1}`,
    brand: 'CuteBunny',
    category: 'Evening Dress',
    thumbnail: null,
    stock_on_hand: 3,
    slots: dates.map((date) => ({
      date,
      status: 'available',
      order_id: null,
    })),
  }));
}
