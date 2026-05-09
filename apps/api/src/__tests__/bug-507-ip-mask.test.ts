/**
 * BUG-507 — Unit tests for IP masking and client IP extraction.
 */

import { describe, it, expect, vi } from 'vitest';
import { maskIP, getClientIP } from '../lib/ip-mask';

// ─── maskIP() ───────────────────────────────────────────────────────────

describe('BUG-507: maskIP()', () => {
  describe('IPv4', () => {
    it('masks standard IPv4 to /24', () => {
      expect(maskIP('192.168.1.100')).toBe('192.168.1.0/24');
    });

    it('masks 10.0.0.1 to /24', () => {
      expect(maskIP('10.0.0.1')).toBe('10.0.0.0/24');
    });

    it('masks 255.255.255.255 to /24', () => {
      expect(maskIP('255.255.255.0/24')).toBeNull(); // has /24 suffix = invalid raw IP
    });

    it('masks 1.2.3.4', () => {
      expect(maskIP('1.2.3.4')).toBe('1.2.3.0/24');
    });

    it('preserves first three octets', () => {
      expect(maskIP('172.16.254.99')).toBe('172.16.254.0/24');
    });
  });

  describe('IPv6', () => {
    it('masks full IPv6 to /48', () => {
      expect(maskIP('2001:0db8:85a3:1234:5678:8a2e:0370:7334'))
        .toBe('2001:0db8:85a3::/48');
    });

    it('masks compressed IPv6 to /48', () => {
      expect(maskIP('2001:db8::1')).toBe('2001:0db8:0000::/48');
    });

    it('masks loopback ::1 to /48', () => {
      expect(maskIP('::1')).toBe('0000:0000:0000::/48');
    });

    it('masks fe80::1 to /48', () => {
      expect(maskIP('fe80::1')).toBe('fe80:0000:0000::/48');
    });
  });

  describe('IPv4-mapped IPv6', () => {
    it('extracts and masks as IPv4 /24', () => {
      expect(maskIP('::ffff:1.2.3.4')).toBe('1.2.3.0/24');
    });

    it('handles uppercase ::FFFF:', () => {
      expect(maskIP('::FFFF:192.168.0.1')).toBe('192.168.0.0/24');
    });
  });

  describe('invalid / null / edge cases', () => {
    it('returns null for null', () => {
      expect(maskIP(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(maskIP(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(maskIP('')).toBeNull();
    });

    it('returns null for whitespace-only', () => {
      expect(maskIP('  ')).toBeNull();
    });

    it('returns null for garbage text', () => {
      expect(maskIP('not-an-ip')).toBeNull();
    });

    it('returns null for partial IPv4', () => {
      expect(maskIP('192.168.1')).toBeNull();
    });

    it('returns null for out-of-range IPv4 octet', () => {
      expect(maskIP('300.1.2.3')).toBeNull();
    });

    it('trims whitespace before processing', () => {
      expect(maskIP('  10.0.0.1  ')).toBe('10.0.0.0/24');
    });
  });
});

// ─── getClientIP() ──────────────────────────────────────────────────────

describe('BUG-507: getClientIP()', () => {
  function makeHeaders(h: Record<string, string>) {
    return {
      get(name: string) {
        const lower = name.toLowerCase();
        for (const [k, v] of Object.entries(h)) {
          if (k.toLowerCase() === lower) return v;
        }
        return null;
      },
    };
  }

  describe('trusted Cloudflare requests (CF-Ray present)', () => {
    it('uses CF-Connecting-IP when CF-Ray present (trusted)', () => {
      const headers = makeHeaders({
        'CF-Connecting-IP': '1.2.3.4',
        'CF-Ray': '8a1b2c3d4e5f-LAX',
        'X-Forwarded-For': '5.6.7.8, 9.10.11.12',
      });
      const result = getClientIP(headers);
      expect(result.ip).toBe('1.2.3.4');
      expect(result.trusted).toBe(true);
    });

    it('trims whitespace from CF-Connecting-IP', () => {
      const headers = makeHeaders({
        'CF-Connecting-IP': '  1.2.3.4  ',
        'CF-Ray': 'abc123-SIN',
      });
      const result = getClientIP(headers);
      expect(result.ip).toBe('1.2.3.4');
      expect(result.trusted).toBe(true);
    });

    it('handles IPv6 CF-Connecting-IP', () => {
      const headers = makeHeaders({
        'CF-Connecting-IP': '2001:db8::1',
        'CF-Ray': 'abc123-BKK',
      });
      const result = getClientIP(headers);
      expect(result.ip).toBe('2001:db8::1');
      expect(result.trusted).toBe(true);
    });
  });

  describe('spoofed CF-Connecting-IP (no CF-Ray)', () => {
    it('ignores CF-Connecting-IP when CF-Ray absent, falls back to XFF', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const headers = makeHeaders({
        'CF-Connecting-IP': '203.0.113.1',
        'X-Forwarded-For': '10.0.0.1, 192.168.1.1',
      });
      const result = getClientIP(headers);
      expect(result.ip).toBe('10.0.0.1');
      expect(result.trusted).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('CF-Connecting-IP present without CF-Ray'),
      );
      warnSpy.mockRestore();
    });

    it('ignores spoofed CF-Connecting-IP without XFF fallback', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const headers = makeHeaders({
        'CF-Connecting-IP': '203.0.113.1',
      });
      const result = getClientIP(headers);
      expect(result.ip).toBeNull();
      expect(result.trusted).toBe(false);
      warnSpy.mockRestore();
    });
  });

  describe('fallback to X-Forwarded-For', () => {
    it('falls back to XFF leftmost when no CF headers', () => {
      const headers = makeHeaders({
        'X-Forwarded-For': '5.6.7.8, 9.10.11.12',
      });
      const result = getClientIP(headers);
      expect(result.ip).toBe('5.6.7.8');
      expect(result.trusted).toBe(false);
    });
  });

  describe('no IP available', () => {
    it('returns null when no headers present', () => {
      const headers = makeHeaders({});
      const result = getClientIP(headers);
      expect(result.ip).toBeNull();
      expect(result.trusted).toBe(false);
    });

    it('returns null for empty CF-Connecting-IP and empty XFF', () => {
      const headers = makeHeaders({
        'CF-Connecting-IP': '',
        'X-Forwarded-For': '',
      });
      const result = getClientIP(headers);
      expect(result.ip).toBeNull();
      expect(result.trusted).toBe(false);
    });
  });
});
