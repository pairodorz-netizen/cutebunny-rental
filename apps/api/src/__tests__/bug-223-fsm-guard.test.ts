/**
 * BUG-223: Order status modal missing valid FSM guard.
 *
 * Root cause: The FSM allowed invalid "jump to finished" transitions from
 * early states (unpaid, paid_locked, shipped). These skip the rental cycle
 * and should not be available.
 *
 * Fix: Removed 'finished' from allowed transitions for unpaid, paid_locked,
 * and shipped. Only returned and repair can transition to finished.
 */
import { describe, it, expect } from 'vitest';
import { isValidTransition, getAllowedTransitions, getForwardTransitions, getBackwardTransitions } from '../lib/state-machine';

describe('BUG-223: FSM rejects invalid transitions', () => {
  describe('paid_locked — should NOT allow jump to finished', () => {
    it('paid_locked → finished should be invalid', () => {
      expect(isValidTransition('paid_locked', 'finished')).toBe(false);
    });

    it('paid_locked → shipped should be valid (forward)', () => {
      expect(isValidTransition('paid_locked', 'shipped')).toBe(true);
    });

    it('paid_locked → unpaid should be valid (rollback)', () => {
      expect(isValidTransition('paid_locked', 'unpaid')).toBe(true);
    });

    it('paid_locked → cancelled should be valid', () => {
      expect(isValidTransition('paid_locked', 'cancelled')).toBe(true);
    });

    it('paid_locked allowed transitions should NOT include finished', () => {
      const allowed = getAllowedTransitions('paid_locked');
      expect(allowed).not.toContain('finished');
      expect(allowed).toContain('shipped');
      expect(allowed).toContain('unpaid');
      expect(allowed).toContain('cancelled');
    });
  });

  describe('unpaid — should NOT allow jump to finished', () => {
    it('unpaid → finished should be invalid', () => {
      expect(isValidTransition('unpaid', 'finished')).toBe(false);
    });

    it('unpaid → paid_locked should be valid', () => {
      expect(isValidTransition('unpaid', 'paid_locked')).toBe(true);
    });

    it('unpaid → cancelled should be valid', () => {
      expect(isValidTransition('unpaid', 'cancelled')).toBe(true);
    });
  });

  describe('shipped — should NOT allow jump to finished', () => {
    it('shipped → finished should be invalid', () => {
      expect(isValidTransition('shipped', 'finished')).toBe(false);
    });

    it('shipped → returned should be valid (forward)', () => {
      expect(isValidTransition('shipped', 'returned')).toBe(true);
    });
  });

  describe('returned — CAN transition to finished (late in cycle)', () => {
    it('returned → finished should be valid', () => {
      expect(isValidTransition('returned', 'finished')).toBe(true);
    });

    it('returned → repair should be valid', () => {
      expect(isValidTransition('returned', 'repair')).toBe(true);
    });
  });

  describe('repair — CAN transition to finished', () => {
    it('repair → finished should be valid', () => {
      expect(isValidTransition('repair', 'finished')).toBe(true);
    });
  });

  describe('forward vs backward transitions are correctly separated', () => {
    it('forward from paid_locked is only shipped', () => {
      expect(getForwardTransitions('paid_locked')).toEqual(['shipped']);
    });

    it('backward from paid_locked is unpaid + cancelled (no finished)', () => {
      const backward = getBackwardTransitions('paid_locked');
      expect(backward).toContain('unpaid');
      expect(backward).toContain('cancelled');
      expect(backward).not.toContain('finished');
    });
  });

  describe('terminal states', () => {
    it('cancelled has no transitions', () => {
      expect(getAllowedTransitions('cancelled')).toEqual([]);
    });

    it('finished can reopen to repair or cancel', () => {
      const allowed = getAllowedTransitions('finished');
      expect(allowed).toContain('repair');
      expect(allowed).toContain('cancelled');
    });
  });
});
