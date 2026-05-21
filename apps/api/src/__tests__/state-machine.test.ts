import { describe, it, expect } from 'vitest';
import { isValidTransition, getAllowedTransitions, getTransitionError } from '../lib/state-machine';

describe('Order State Machine', () => {
  describe('isValidTransition', () => {
    it('allows unpaid → paid_locked', () => {
      expect(isValidTransition('unpaid', 'paid_locked')).toBe(true);
    });

    it('allows paid_locked → shipped', () => {
      expect(isValidTransition('paid_locked', 'shipped')).toBe(true);
    });

    it('allows shipped → returned', () => {
      expect(isValidTransition('shipped', 'returned')).toBe(true);
    });

    it('allows returned → finished', () => {
      expect(isValidTransition('returned', 'finished')).toBe(true);
    });

    it('allows returned → repair', () => {
      expect(isValidTransition('returned', 'repair')).toBe(true);
    });

    it('allows repair → finished', () => {
      expect(isValidTransition('repair', 'finished')).toBe(true);
    });

    it('rejects unpaid → shipped (skipping paid_locked)', () => {
      expect(isValidTransition('unpaid', 'shipped')).toBe(false);
    });

    // BUG-223: shipped → finished is no longer valid (must go through returned first)
    it('rejects shipped → finished (no skip forward)', () => {
      expect(isValidTransition('shipped', 'finished')).toBe(false);
    });

    it('allows finished → repair (reopen for repair)', () => {
      expect(isValidTransition('finished', 'repair')).toBe(true);
    });

    it('rejects finished → unpaid (not allowed)', () => {
      expect(isValidTransition('finished', 'unpaid')).toBe(false);
    });

    it('rejects cancelled → any (terminal)', () => {
      expect(isValidTransition('cancelled', 'unpaid')).toBe(false);
    });
  });

  describe('getAllowedTransitions', () => {
    it('returns transitions for unpaid', () => {
      // BUG-223: removed 'finished' from early-state transitions
      expect(getAllowedTransitions('unpaid')).toEqual(['paid_locked', 'cancelled']);
    });

    it('returns transitions for paid_locked', () => {
      // BUG-223: removed 'finished' from early-state transitions
      expect(getAllowedTransitions('paid_locked')).toEqual(['shipped', 'unpaid', 'cancelled']);
    });

    it('returns transitions for shipped', () => {
      // BUG-223: removed 'finished' from early-state transitions
      expect(getAllowedTransitions('shipped')).toEqual(['returned', 'paid_locked', 'cancelled']);
    });

    it('returns transitions for returned', () => {
      expect(getAllowedTransitions('returned')).toEqual(['repair', 'shipped', 'finished', 'cancelled']);
    });

    it('returns transitions for repair', () => {
      expect(getAllowedTransitions('repair')).toEqual(['finished', 'returned', 'cancelled']);
    });

    it('returns transitions for finished (non-terminal, can reopen)', () => {
      expect(getAllowedTransitions('finished')).toEqual(['repair', 'cancelled']);
    });

    it('returns [] for cancelled (terminal state)', () => {
      expect(getAllowedTransitions('cancelled')).toEqual([]);
    });
  });

  describe('getTransitionError', () => {
    it('returns terminal state message for cancelled', () => {
      const msg = getTransitionError('cancelled', 'unpaid');
      expect(msg).toContain('terminal state');
    });

    it('returns invalid transition message for finished → unpaid', () => {
      const msg = getTransitionError('finished', 'unpaid');
      expect(msg).toContain('Invalid transition');
      expect(msg).toContain('repair');
    });

    it('returns allowed transitions for invalid transition', () => {
      const msg = getTransitionError('unpaid', 'shipped');
      expect(msg).toContain('paid_locked');
      expect(msg).toContain('Invalid transition');
    });
  });
});
