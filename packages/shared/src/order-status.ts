/**
 * Shared order status helpers for customer, admin, and API.
 *
 * Canonical enum: unpaid, paid_locked, shipped, returned, repair, finished, cancelled
 * Customer-facing: paid_locked shows as "Payment Confirmed" (not raw enum).
 */

export const ORDER_STATUSES = [
  'unpaid',
  'paid_locked',
  'shipped',
  'returned',
  'repair',
  'finished',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// ── Labels ──────────────────────────────────────────────────────────

const LABELS_TH: Record<OrderStatus, string> = {
  unpaid: 'รอชำระเงิน',
  paid_locked: 'ยืนยันชำระแล้ว',
  shipped: 'จัดส่งแล้ว',
  returned: 'ส่งคืนแล้ว',
  repair: 'ระหว่างซ่อม',
  finished: 'เสร็จสมบูรณ์',
  cancelled: 'ยกเลิก',
};

const LABELS_EN: Record<OrderStatus, string> = {
  unpaid: 'Awaiting Payment',
  paid_locked: 'Payment Confirmed',
  shipped: 'Shipped',
  returned: 'Returned',
  repair: 'Under Repair',
  finished: 'Completed',
  cancelled: 'Cancelled',
};

const LABELS: Record<string, Record<OrderStatus, string>> = {
  th: LABELS_TH,
  en: LABELS_EN,
  zh: LABELS_EN, // fallback to English for Chinese
};

export function getStatusLabel(status: string, locale: string): string {
  const map = LABELS[locale] ?? LABELS_EN;
  return map[status as OrderStatus] ?? status;
}

// ── Colors (Tailwind classes — WCAG AA contrast) ────────────────────

export interface StatusColorSet {
  bg: string;
  text: string;
  badge: string; // combined bg + text for convenience
}

const STATUS_COLORS: Record<OrderStatus, StatusColorSet> = {
  unpaid: { bg: 'bg-amber-100', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-800' },
  paid_locked: { bg: 'bg-blue-100', text: 'text-blue-800', badge: 'bg-blue-100 text-blue-800' },
  shipped: { bg: 'bg-purple-100', text: 'text-purple-800', badge: 'bg-purple-100 text-purple-800' },
  returned: { bg: 'bg-indigo-100', text: 'text-indigo-800', badge: 'bg-indigo-100 text-indigo-800' },
  repair: { bg: 'bg-orange-100', text: 'text-orange-800', badge: 'bg-orange-100 text-orange-800' },
  finished: { bg: 'bg-green-100', text: 'text-green-800', badge: 'bg-green-100 text-green-800' },
  cancelled: { bg: 'bg-gray-100', text: 'text-gray-600', badge: 'bg-gray-100 text-gray-600' },
};

const DEFAULT_COLOR: StatusColorSet = { bg: 'bg-gray-100', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-700' };

export function getStatusColor(status: string): StatusColorSet {
  return STATUS_COLORS[status as OrderStatus] ?? DEFAULT_COLOR;
}

// ── Icons (Lucide icon names as strings) ────────────────────────────

const STATUS_ICONS: Record<OrderStatus, string> = {
  unpaid: 'clock',
  paid_locked: 'lock',
  shipped: 'truck',
  returned: 'package-check',
  repair: 'wrench',
  finished: 'check-circle',
  cancelled: 'x-circle',
};

export function getStatusIcon(status: string): string {
  return STATUS_ICONS[status as OrderStatus] ?? 'circle';
}

// ── Timeline Steps ──────────────────────────────────────────────────
// Main flow: paid_locked → shipped → returned → finished
// Sub-state: repair sits between returned and finished.
// cancelled is a terminal state shown separately (not in the timeline).

export interface TimelineStep {
  key: string;
  labelKey: OrderStatus;
  completed: boolean;
  active: boolean;
}

const MAIN_STEPS: OrderStatus[] = ['paid_locked', 'shipped', 'returned', 'finished'];
const STEP_ORDER: Record<string, number> = {
  unpaid: -1,
  paid_locked: 0,
  shipped: 1,
  returned: 2,
  repair: 2.5,
  finished: 3,
  cancelled: -2,
};

export function getStatusStep(status: string): number {
  return STEP_ORDER[status] ?? -1;
}

export function getTimelineSteps(currentStatus: string): TimelineStep[] {
  const currentStep = getStatusStep(currentStatus);

  return MAIN_STEPS.map((stepStatus, idx) => ({
    key: stepStatus,
    labelKey: stepStatus,
    completed: currentStep > idx,
    active: (currentStatus === stepStatus) ||
      // repair is active at the returned→finished gap
      (idx === 2 && currentStatus === 'repair') ||
      (idx === 3 && currentStatus === 'finished'),
  }));
}

export function isCancelled(status: string): boolean {
  return status === 'cancelled';
}

export function isTerminal(status: string): boolean {
  return status === 'finished' || status === 'cancelled';
}
