/**
 * BUG-CAL-05 — Slot state machine for click-to-edit calendar cells.
 *
 * Pure, framework-free. Shared between:
 *   • apps/admin/src/pages/calendar.tsx  — dropdown options + pre-flight guard
 *   • apps/api/src/routes/admin/calendar.ts — PATCH /cell validator
 *
 * The enum values mirror Prisma's `SlotStatus` exactly (DB-truthy keys).
 * `SLOT_STATE_LABELS` carries the human-readable display names the
 * popover renders — `blocked_repair` renders as "Repair" per owner's
 * brief so the UI is compact.
 *
 * Transition policy (owner-ratified):
 *   from === to                                 → no-op
 *   from === 'booked'   && to === 'available'   → requires confirm
 *   from !== 'available'&& to === 'available'   → requires confirm
 *                                                 (releasing any blocked
 *                                                 slot is destructive)
 *   otherwise                                   → OK (admin discretion)
 */

export const SLOT_STATES = [
  'available',
  'booked',
  'cleaning',
  'blocked_repair',
  'late_return',
  'tentative',
  'shipping',
  'washing',
] as const;

export type SlotState = (typeof SLOT_STATES)[number];

export const SLOT_STATE_LABELS: Record<SlotState, string> = {
  available: 'Available',
  booked: 'Booked',
  cleaning: 'Cleaning',
  blocked_repair: 'Repair',
  late_return: 'Late Return',
  tentative: 'Tentative',
  shipping: 'Shipping',
  washing: 'Washing',
};

export type TransitionResult =
  | { ok: true; noop: true }
  | { ok: true; confirm: false }
  | { ok: true; confirm: true; reason: string }
  | { ok: false; reason: string };

export function isValidState(s: string): s is SlotState {
  return (SLOT_STATES as readonly string[]).includes(s);
}

export function canTransition(from: SlotState, to: SlotState): TransitionResult {
  if (from === to) return { ok: true, noop: true };
  // Releasing a non-free slot back to `available` wipes the reason the
  // slot was blocked — force an explicit confirmation to avoid stray
  // clicks erasing a booking or a repair hold.
  if (to === 'available' && from !== 'available') {
    return {
      ok: true,
      confirm: true,
      reason: `Releasing a ${SLOT_STATE_LABELS[from].toLowerCase()} slot — please confirm.`,
    };
  }
  return { ok: true, confirm: false };
}
