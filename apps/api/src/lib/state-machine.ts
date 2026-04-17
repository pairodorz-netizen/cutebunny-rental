import type { OrderStatus } from '@prisma/client';

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  unpaid: ['paid_locked', 'finished', 'cancelled'],
  paid_locked: ['shipped', 'unpaid', 'finished', 'cancelled'],
  shipped: ['returned', 'paid_locked', 'finished', 'cancelled'],
  returned: ['cleaning', 'shipped', 'finished', 'cancelled'],
  cleaning: ['repair', 'finished', 'returned', 'cancelled'],
  repair: ['finished', 'cleaning', 'cancelled'],
  finished: ['cleaning', 'repair', 'cancelled'],
  cancelled: [],
};

// Forward transitions (normal flow)
const FORWARD_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  unpaid: ['paid_locked'],
  paid_locked: ['shipped'],
  shipped: ['returned'],
  returned: ['cleaning'],
  cleaning: ['repair', 'finished'],
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
