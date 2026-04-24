/**
 * BUG-COMBO-DELETE-02 — pure classifier for the frontend delete handler.
 *
 * The admin page `apps/admin/src/pages/products.tsx` reads a DELETE response
 * or Error and must dispatch three things deterministically:
 *   1. toast variant + i18n key     (user feedback)
 *   2. rollback: boolean            (put the optimistic row back)
 *   3. refresh: boolean             (re-fetch to reconcile stale cache)
 *   4. redirect: boolean            (bounce to /login on 401)
 *
 * This module captures that policy as a pure function so it can be tested
 * without DOM/react-query infra. The admin side imports the classifier
 * and only owns the visual rendering.
 *
 * Policy (owner-ratified in the ATOM 02 brief):
 *   • 200                  → kind='success',      toast=comboDeleteSuccess,   rollback=false, refresh=true,  redirect=false
 *   • 409 ACTIVE_RENTALS   → kind='active_rentals', toast=comboDeleteActiveRentals (w/ count), rollback=true, refresh=false, redirect=false
 *   • 404 NOT_FOUND        → kind='not_found',    toast=comboDeleteNotFound,  rollback=false, refresh=true,  redirect=false
 *   • 401 UNAUTHORIZED     → kind='auth',         toast=comboDeleteAuthLost,  rollback=true,  refresh=false, redirect=true
 *   • network / unknown    → kind='unknown',      toast=comboDeleteNetwork,   rollback=true,  refresh=false, redirect=false
 */
import { describe, it, expect } from 'vitest';
import {
  classifyComboDeleteResult,
  type ComboDeleteOutcome,
} from '@cutebunny/shared/combo-delete-state';

describe('BUG-COMBO-DELETE-02 — classifyComboDeleteResult', () => {
  describe('success (200)', () => {
    it('200 → kind=success, toast success, no rollback, refresh', () => {
      const out: ComboDeleteOutcome = classifyComboDeleteResult({
        status: 200,
        body: { data: { id: 'c1', deleted: true, mode: 'hard' } },
      });
      expect(out.kind).toBe('success');
      expect(out.toastVariant).toBe('success');
      expect(out.toastKey).toBe('products.comboDeleteSuccess');
      expect(out.rollback).toBe(false);
      expect(out.refresh).toBe(true);
      expect(out.redirect).toBe(false);
    });
  });

  describe('409 ACTIVE_RENTALS', () => {
    it('→ kind=active_rentals, rollback+no refresh', () => {
      const out = classifyComboDeleteResult({
        status: 409,
        body: {
          error: {
            code: 'ACTIVE_RENTALS',
            message: 'Cannot delete combo set with 2 active rentals',
            details: { rentalCount: 2 },
          },
        },
      });
      expect(out.kind).toBe('active_rentals');
      expect(out.toastVariant).toBe('error');
      expect(out.toastKey).toBe('products.comboDeleteActiveRentals');
      expect(out.toastParams).toEqual({ count: 2 });
      expect(out.rollback).toBe(true);
      expect(out.refresh).toBe(false);
      expect(out.redirect).toBe(false);
    });

    it('falls back to count=1 when details missing', () => {
      const out = classifyComboDeleteResult({
        status: 409,
        body: { error: { code: 'ACTIVE_RENTALS', message: 'x' } },
      });
      expect(out.kind).toBe('active_rentals');
      expect(out.toastParams).toEqual({ count: 1 });
    });
  });

  describe('404 NOT_FOUND', () => {
    it('→ kind=not_found, no rollback, refresh (stale cache)', () => {
      const out = classifyComboDeleteResult({
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'Combo set not found' } },
      });
      expect(out.kind).toBe('not_found');
      expect(out.toastVariant).toBe('error');
      expect(out.toastKey).toBe('products.comboDeleteNotFound');
      expect(out.rollback).toBe(false);
      expect(out.refresh).toBe(true);
      expect(out.redirect).toBe(false);
    });
  });

  describe('401 UNAUTHORIZED', () => {
    it('→ kind=auth, rollback, redirect', () => {
      const out = classifyComboDeleteResult({
        status: 401,
        body: { error: { code: 'UNAUTHORIZED', message: 'missing token' } },
      });
      expect(out.kind).toBe('auth');
      expect(out.toastVariant).toBe('error');
      expect(out.toastKey).toBe('products.comboDeleteAuthLost');
      expect(out.rollback).toBe(true);
      expect(out.refresh).toBe(false);
      expect(out.redirect).toBe(true);
    });
  });

  describe('network / unknown', () => {
    it('TypeError (fetch failed) → kind=unknown, rollback, network toast', () => {
      const out = classifyComboDeleteResult({
        error: new TypeError('Failed to fetch'),
      });
      expect(out.kind).toBe('unknown');
      expect(out.toastVariant).toBe('error');
      expect(out.toastKey).toBe('products.comboDeleteNetwork');
      expect(out.rollback).toBe(true);
      expect(out.refresh).toBe(false);
      expect(out.redirect).toBe(false);
    });

    it('unclassified 5xx → kind=unknown, rollback, network toast', () => {
      const out = classifyComboDeleteResult({
        status: 502,
        body: { error: { code: 'BAD_GATEWAY', message: 'upstream' } },
      });
      expect(out.kind).toBe('unknown');
      expect(out.rollback).toBe(true);
      expect(out.redirect).toBe(false);
    });

    it('unrecognised error code at 409 still routes to active_rentals-like conflict', () => {
      // Defence-in-depth: treat any 409 as a rollback case even if the
      // error.code is unexpected so the admin doesn't lose the row on
      // a route change.
      const out = classifyComboDeleteResult({
        status: 409,
        body: { error: { code: 'SOMETHING_ELSE', message: 'x' } },
      });
      expect(out.rollback).toBe(true);
      expect(out.refresh).toBe(false);
      expect(out.redirect).toBe(false);
    });
  });

  describe('shape stability', () => {
    it('returns a plain object with all 6 keys populated', () => {
      const out = classifyComboDeleteResult({
        status: 200,
        body: { data: { id: 'c1', deleted: true, mode: 'hard' } },
      });
      expect(Object.keys(out).sort()).toEqual([
        'kind',
        'redirect',
        'refresh',
        'rollback',
        'toastKey',
        'toastVariant',
      ]);
    });
  });
});
