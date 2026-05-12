/**
 * BUG-508 Phase 2 — IP address INET cast regex validation.
 *
 * Tests the PostgreSQL regex used in the migration USING clause:
 *   CASE WHEN ip_address ~ '^[0-9a-fA-F.:]+(/[0-9]+)?$' THEN ip_address::inet ELSE NULL END
 *
 * Ensures valid IPs pass through and invalid values are safely NULLed.
 */

import { describe, it, expect } from 'vitest';

// The exact regex from the migration SQL (PostgreSQL ~ operator syntax)
const IP_INET_REGEX = /^[0-9a-fA-F.:]+(?:\/[0-9]+)?$/;

describe('BUG-508 Phase 2: IP INET cast regex', () => {
  describe('valid IPv4 addresses — should match', () => {
    const validIPv4 = [
      '192.168.1.1',
      '10.0.0.1',
      '172.16.0.1',
      '255.255.255.255',
      '0.0.0.0',
      '127.0.0.1',
      '1.2.3.4',
    ];

    for (const ip of validIPv4) {
      it(`matches ${ip}`, () => {
        expect(IP_INET_REGEX.test(ip)).toBe(true);
      });
    }
  });

  describe('valid IPv4 CIDR — should match', () => {
    const validCIDR = [
      '192.168.1.0/24',
      '10.0.0.0/8',
      '0.0.0.0/0',
      '172.16.0.0/12',
    ];

    for (const cidr of validCIDR) {
      it(`matches ${cidr}`, () => {
        expect(IP_INET_REGEX.test(cidr)).toBe(true);
      });
    }
  });

  describe('valid IPv6 addresses — should match', () => {
    const validIPv6 = [
      '::1',
      '::',
      '2001:db8::1',
      'fe80::1',
      '::ffff:192.168.1.1',
      'fe80::1:2:3:4',
      '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
    ];

    for (const ip of validIPv6) {
      it(`matches ${ip}`, () => {
        expect(IP_INET_REGEX.test(ip)).toBe(true);
      });
    }
  });

  describe('valid IPv6 CIDR — should match', () => {
    const validIPv6CIDR = [
      '::1/128',
      '2001:db8::/32',
      'fe80::/10',
      '::/0',
    ];

    for (const cidr of validIPv6CIDR) {
      it(`matches ${cidr}`, () => {
        expect(IP_INET_REGEX.test(cidr)).toBe(true);
      });
    }
  });

  describe('invalid values — should NOT match (will become NULL)', () => {
    const invalid = [
      '',
      'unknown',
      'localhost',
      'null',
      'N/A',
      '192.168.1.1; DROP TABLE',
      'http://192.168.1.1',
      // Note: '192.168.1.1:8080' passes the regex (colon is allowed for IPv6)
      // but will fail the PostgreSQL ::inet cast. The regex is a pre-filter.
      'abc def',
      ' 192.168.1.1',
      '192.168.1.1 ',
      'not-an-ip',
      '192.168.1.1\n',
    ];

    for (const val of invalid) {
      it(`rejects "${val.replace(/\n/g, '\\n')}"`, () => {
        expect(IP_INET_REGEX.test(val)).toBe(false);
      });
    }
  });

  describe('edge cases from BUG-507 PII masked IPs — should match', () => {
    // BUG-507 masks IPs to /24 (IPv4) or /48 (IPv6) with host()
    // After masking: "192.168.1.0" (still valid IP format)
    const maskedIPs = [
      '192.168.1.0',    // masked /24 IPv4
      '10.0.0.0',       // masked /8 IPv4
      '2001:db8::',     // masked IPv6
    ];

    for (const ip of maskedIPs) {
      it(`matches masked IP ${ip}`, () => {
        expect(IP_INET_REGEX.test(ip)).toBe(true);
      });
    }
  });
});
