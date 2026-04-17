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
      expect(isValidTransition('cleaning', 'ready')).toBe(true);
    });

    it('allows repair → ready', () => {
      expect(isValidTransition('repair', 'ready')).toBe(true);
    });

    it('rejects unpaid → shipped (skipping paid_locked)', () => {
      expect(isValidTransition('unpaid', 'shipped')).toBe(false);
    });

    it('rejects shipped → ready (skipping returned/cleaning)', () => {
      expect(isValidTransition('shipped', 'ready')).toBe(false);
    });

    it('rejects ready → unpaid (backward transition)', () => {
      expect(isValidTransition('ready', 'unpaid')).toBe(false);
    });

    it('rejects paid_locked → returned (skipping shipped)', () => {
      expect(isValidTransition('paid_locked', 'returned')).toBe(false);
    });

    it('rejects returned → shipped (backward transition)', () => {
      expect(isValidTransition('returned', 'shipped')).toBe(false);
    });
  });

  describe('getAllowedTransitions', () => {
    it('returns [paid_locked] for unpaid', () => {
      expect(getAllowedTransitions('unpaid')).toEqual(['paid_locked']);
    });

    it('returns [shipped] for paid_locked', () => {
      expect(getAllowedTransitions('paid_locked')).toEqual(['shipped']);
    });

    it('returns [returned] for shipped', () => {
      expect(getAllowedTransitions('shipped')).toEqual(['returned']);
    });

    it('returns [cleaning] for returned', () => {
      expect(getAllowedTransitions('returned')).toEqual(['cleaning']);
    });

    it('returns [repair, ready] for cleaning', () => {
      expect(getAllowedTransitions('cleaning')).toEqual(['repair', 'ready']);
    });

    it('returns [ready] for repair', () => {
      expect(getAllowedTransitions('repair')).toEqual(['ready']);
    });

    it('returns [] for ready (terminal state)', () => {
      expect(getAllowedTransitions('ready')).toEqual([]);
    });
  });

  describe('getTransitionError', () => {
    it('returns terminal state message for ready', () => {
      const msg = getTransitionError('ready', 'unpaid');
      expect(msg).toContain('terminal state');
    });

    it('returns allowed transitions for invalid transition', () => {
      const msg = getTransitionError('unpaid', 'shipped');
      expect(msg).toContain('paid_locked');
      expect(msg).toContain('Invalid transition');
    });
  });
});
