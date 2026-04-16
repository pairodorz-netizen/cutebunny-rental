import type { OrderStatus } from '@prisma/client';

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  unpaid: ['paid_locked'],
  paid_locked: ['shipped'],
  shipped: ['returned'],
  returned: ['cleaning'],
  cleaning: ['repair', 'ready'],
  repair: ['ready'],
  ready: [],
};

export function getAllowedTransitions(currentStatus: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[currentStatus] ?? [];
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
