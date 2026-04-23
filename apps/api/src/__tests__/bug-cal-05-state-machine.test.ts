/**
 * BUG-CAL-05: Click-to-edit cell state machine (pure logic).
 *
 * Covers the transition rules that the PATCH endpoint will enforce and
 * that the UI popover will consult before firing a mutation. Pure —
 * no DB, no HTTP — so it's the cheapest gate on the wave.
 *
 * Transition policy (owner-ratified):
 *   • from === to         → NOOP (no-op, no audit, no HTTP)
 *   • from === 'booked'   → 'available'  → REQUIRES_CONFIRM
 *   • to   === 'available' && from !== 'available' → REQUIRES_CONFIRM
 *     (releasing a non-free slot is always destructive, regardless of
 *     whether it was "booked" or something like "cleaning" / "repair")
 *   • everything else     → OK (admin discretion)
 *
 * Invalid states throw — the enum lives in shared and we don't silently
 * coerce unknown strings to prevent PATCH calls with typos from landing
 * as Prisma errors.
 */
import { describe, it, expect } from 'vitest';
import {
  SLOT_STATES,
  SLOT_STATE_LABELS,
  canTransition,
  isValidState,
  type SlotState,
} from '@cutebunny/shared/calendar-state-machine';

describe('BUG-CAL-05 — slot state machine', () => {
  it('SLOT_STATES matches the prisma enum (8 entries, exact order)', () => {
    // Keep the UI dropdown order stable — this is the order owner listed
    // in the brief (Available → Booked → Cleaning → Repair → Late Return
    // → Tentative → Shipping → Washing). Prisma enum name for "Repair"
    // is `blocked_repair` so the enum key here stays DB-accurate while
    // the LABEL says "Repair".
    expect(SLOT_STATES).toEqual([
      'available',
      'booked',
      'cleaning',
      'blocked_repair',
      'late_return',
      'tentative',
      'shipping',
      'washing',
    ]);
  });

  it('every state has a human-readable label', () => {
    for (const s of SLOT_STATES) {
      expect(SLOT_STATE_LABELS[s]).toBeTruthy();
      expect(SLOT_STATE_LABELS[s].length).toBeGreaterThan(0);
    }
    // Spot-check owner's brief wording — "Repair" not "Blocked Repair".
    expect(SLOT_STATE_LABELS.blocked_repair).toBe('Repair');
    expect(SLOT_STATE_LABELS.late_return).toBe('Late Return');
  });

  it('isValidState accepts every enum member and rejects unknowns', () => {
    for (const s of SLOT_STATES) expect(isValidState(s)).toBe(true);
    expect(isValidState('Available')).toBe(false); // case matters
    expect(isValidState('AVAILABLE')).toBe(false);
    expect(isValidState('repair')).toBe(false); // should be blocked_repair
    expect(isValidState('')).toBe(false);
    expect(isValidState('booked ')).toBe(false);
  });

  it('same-state transition is a no-op (ok + noop flag)', () => {
    for (const s of SLOT_STATES) {
      const r = canTransition(s, s);
      expect(r).toEqual({ ok: true, noop: true });
    }
  });

  it('available → booked is a straight OK (no confirm)', () => {
    const r = canTransition('available', 'booked');
    expect(r).toEqual({ ok: true, confirm: false });
  });

  it('available → any non-available is a straight OK', () => {
    for (const s of SLOT_STATES) {
      if (s === 'available') continue;
      const r = canTransition('available', s);
      expect(r).toEqual({ ok: true, confirm: false });
    }
  });

  it('booked → available requires confirm (destructive)', () => {
    const r = canTransition('booked', 'available');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('confirm' in r && r.confirm).toBe(true);
      expect('reason' in r && typeof r.reason).toBe('string');
    }
  });

  it('any non-available → available requires confirm', () => {
    // Releasing a slot that's currently blocked (cleaning, repair, etc.)
    // is a destructive edit — confirm before wiping the intent.
    const nonAvailable = SLOT_STATES.filter((s): s is SlotState => s !== 'available');
    for (const from of nonAvailable) {
      const r = canTransition(from, 'available');
      expect(r.ok, `${from} → available`).toBe(true);
      if (r.ok && 'confirm' in r) {
        expect(r.confirm, `${from} → available should require confirm`).toBe(true);
      }
    }
  });

  it('cross-blocked-state transitions (e.g. cleaning → repair) are OK (no confirm)', () => {
    // Admin discretion: retagging a blocked slot from one reason to
    // another is not destructive — the slot is still blocked.
    const pairs: Array<[SlotState, SlotState]> = [
      ['cleaning', 'blocked_repair'],
      ['blocked_repair', 'cleaning'],
      ['shipping', 'washing'],
      ['washing', 'shipping'],
      ['tentative', 'booked'],
      ['booked', 'tentative'],
      ['late_return', 'cleaning'],
      ['shipping', 'booked'],
    ];
    for (const [from, to] of pairs) {
      const r = canTransition(from, to);
      expect(r, `${from} → ${to}`).toEqual({ ok: true, confirm: false });
    }
  });

  it('canTransition is total over the full 8×8 matrix (no falls through)', () => {
    // Guard against a future contributor removing a branch and leaving
    // some transitions undefined. Every cell must return a result.
    for (const from of SLOT_STATES) {
      for (const to of SLOT_STATES) {
        const r = canTransition(from, to);
        expect(r, `${from} → ${to}`).toBeTruthy();
        expect(r.ok).toBe(true);
      }
    }
  });

  it('canTransition is deterministic — same inputs, same output', () => {
    const r1 = canTransition('cleaning', 'booked');
    const r2 = canTransition('cleaning', 'booked');
    expect(r1).toEqual(r2);
  });

  it('snapshot of the confirm-required transitions (audit trail)', () => {
    // If a future edit flips a transition's destructiveness, this
    // snapshot breaks loudly rather than silently changing behaviour.
    const confirmRequired: Array<[SlotState, SlotState]> = [];
    for (const from of SLOT_STATES) {
      for (const to of SLOT_STATES) {
        const r = canTransition(from, to);
        if (r.ok && 'confirm' in r && r.confirm) {
          confirmRequired.push([from, to]);
        }
      }
    }
    expect(confirmRequired).toMatchInlineSnapshot(`
      [
        [
          "booked",
          "available",
        ],
        [
          "cleaning",
          "available",
        ],
        [
          "blocked_repair",
          "available",
        ],
        [
          "late_return",
          "available",
        ],
        [
          "tentative",
          "available",
        ],
        [
          "shipping",
          "available",
        ],
        [
          "washing",
          "available",
        ],
      ]
    `);
  });
});
