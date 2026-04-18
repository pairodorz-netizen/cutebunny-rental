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

    it('allows returned → cleaning', () => {
      expect(isValidTransition('returned', 'cleaning')).toBe(true);
    });

    it('allows cleaning → repair', () => {
      expect(isValidTransition('cleaning', 'repair')).toBe(true);
    });

    it('allows cleaning → ready', () => {
      expect(isValidTransition('cleaning', 'finished')).toBe(true);
    });

    it('allows repair → ready', () => {
      expect(isValidTransition('repair', 'finished')).toBe(true);
    });

    it('rejects unpaid → shipped (skipping paid_locked)', () => {
      expect(isValidTransition('unpaid', 'shipped')).toBe(false);
    });

    it('allows shipped → finished (skip forward)', () => {
      expect(isValidTransition('shipped', 'finished')).toBe(true);
    });

    it('allows finished → cleaning (reopen for cleaning)', () => {
      expect(isValidTransition('finished', 'cleaning')).toBe(true);
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
      expect(getAllowedTransitions('unpaid')).toEqual(['paid_locked', 'finished', 'cancelled']);
    });

    it('returns transitions for paid_locked', () => {
      expect(getAllowedTransitions('paid_locked')).toEqual(['shipped', 'unpaid', 'finished', 'cancelled']);
    });

    it('returns transitions for shipped', () => {
      expect(getAllowedTransitions('shipped')).toEqual(['returned', 'paid_locked', 'finished', 'cancelled']);
    });

    it('returns transitions for returned', () => {
      expect(getAllowedTransitions('returned')).toEqual(['cleaning', 'shipped', 'finished', 'cancelled']);
    });

    it('returns transitions for cleaning', () => {
      expect(getAllowedTransitions('cleaning')).toEqual(['repair', 'finished', 'returned', 'cancelled']);
    });

    it('returns transitions for repair', () => {
      expect(getAllowedTransitions('repair')).toEqual(['finished', 'cleaning', 'cancelled']);
    });

    it('returns transitions for finished (non-terminal, can reopen)', () => {
      expect(getAllowedTransitions('finished')).toEqual(['cleaning', 'repair', 'cancelled']);
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
      expect(msg).toContain('cleaning');
    });

    it('returns allowed transitions for invalid transition', () => {
      const msg = getTransitionError('unpaid', 'shipped');
      expect(msg).toContain('paid_locked');
      expect(msg).toContain('Invalid transition');
    });
  });
});
