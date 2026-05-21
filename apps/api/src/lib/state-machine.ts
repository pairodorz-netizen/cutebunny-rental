import type { OrderStatus } from '@prisma/client';

// BUG-223: FSM refined — removed invalid "jump to finished" from early states
// (unpaid, paid_locked, shipped). Only states that are late in the rental cycle
// (returned, repair) can transition to finished.
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  unpaid: ['paid_locked', 'cancelled'],
  paid_locked: ['shipped', 'unpaid', 'cancelled'],
  shipped: ['returned', 'paid_locked', 'cancelled'],
  returned: ['repair', 'shipped', 'finished', 'cancelled'],
  repair: ['finished', 'returned', 'cancelled'],
  finished: ['repair', 'cancelled'],
  cancelled: [],
};

// Forward transitions (normal flow)
const FORWARD_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  unpaid: ['paid_locked'],
  paid_locked: ['shipped'],
  shipped: ['returned'],
  returned: ['finished'],
  repair: ['finished'],
  finished: [],
  cancelled: [],
};

export function getAllowedTransitions(currentStatus: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[currentStatus] ?? [];
}

export function getForwardTransitions(currentStatus: OrderStatus): OrderStatus[] {
  return FORWARD_TRANSITIONS[currentStatus] ?? [];
}

export function getBackwardTransitions(currentStatus: OrderStatus): OrderStatus[] {
  const all = ORDER_TRANSITIONS[currentStatus] ?? [];
  const forward = FORWARD_TRANSITIONS[currentStatus] ?? [];
  return all.filter((s) => !forward.includes(s));
}

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function getTransitionError(from: OrderStatus, to: OrderStatus): string {
  const allowed = getAllowedTransitions(from);
  if (allowed.length === 0) {
    return `Order in status "${from}" is in a terminal state and cannot transition.`;
  }
  return `Invalid transition from "${from}" to "${to}". Allowed transitions: ${allowed.join(', ')}`;
}
