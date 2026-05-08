/**
 * BUG-507 — IP address masking helpers for PII/GDPR compliance.
 *
 * Tiered retention strategy:
 *   0–30 days:  raw IP kept for incident response
 *   31–90 days: masked to /24 (IPv4) or /48 (IPv6)
 *   >90 days:   hard-deleted (set NULL)
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_MAPPED_V6_RE = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

/**
 * Mask an IP address for PII retention.
 *
 * IPv4:           1.2.3.4       → 1.2.3.0/24
 * IPv6:           2001:db8:85a3:1234:5678:8a2e:370:7334 → 2001:db8:85a3::/48
 * IPv4-mapped v6: ::ffff:1.2.3.4 → 1.2.3.0/24
 * Invalid/null:   returns null (caller should log)
 */
export function maskIP(ip: string | null | undefined): string | null {
  if (!ip || typeof ip !== 'string') return null;

  const trimmed = ip.trim();
  if (!trimmed) return null;

  // IPv4-mapped IPv6 → extract and mask as IPv4
  const mappedMatch = trimmed.match(IPV4_MAPPED_V6_RE);
  if (mappedMatch) {
    return maskIPv4(mappedMatch[1]);
  }

  // Pure IPv4
  if (IPV4_RE.test(trimmed)) {
    return maskIPv4(trimmed);
  }

  // IPv6 (contains colon but not IPv4-mapped)
  if (trimmed.includes(':')) {
    return maskIPv6(trimmed);
  }

  return null;
}

function maskIPv4(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

function maskIPv6(ip: string): string | null {
  // Expand :: shorthand to full 8-group form, then keep first 3 groups (/48)
  const expanded = expandIPv6(ip);
  if (!expanded) return null;
  const groups = expanded.split(':');
  if (groups.length !== 8) return null;
  return `${groups[0]}:${groups[1]}:${groups[2]}::/48`;
}

function expandIPv6(ip: string): string | null {
  // Remove zone ID if present (e.g. %eth0)
  const noZone = ip.split('%')[0];

  const parts = noZone.split('::');
  if (parts.length > 2) return null; // invalid: multiple ::

  if (parts.length === 1) {
    // No :: shorthand, must have exactly 8 groups
    const groups = noZone.split(':');
    if (groups.length !== 8) return null;
    if (!groups.every(isValidHexGroup)) return null;
    return groups.map(padHexGroup).join(':');
  }

  // Has :: — expand
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  const fillCount = 8 - left.length - right.length;
  if (fillCount < 0) return null;
  if (!left.every(isValidHexGroup) || !right.every(isValidHexGroup)) return null;

  const full = [
    ...left.map(padHexGroup),
    ...Array(fillCount).fill('0000'),
    ...right.map(padHexGroup),
  ];
  return full.join(':');
}

function isValidHexGroup(g: string): boolean {
  return g.length >= 1 && g.length <= 4 && /^[0-9a-fA-F]+$/.test(g);
}

function padHexGroup(g: string): string {
  return g.padStart(4, '0');
}

/**
 * Extract the client IP from a Cloudflare Worker request.
 *
 * Trust order (per spec):
 *   1. CF-Connecting-IP (set by Cloudflare edge, cannot be spoofed)
 *   2. X-Forwarded-For leftmost (only if CF-Connecting-IP absent)
 *   3. null
 */
export function getClientIP(headers: { get(name: string): string | null }): string | null {
  const cfIP = headers.get('CF-Connecting-IP');
  if (cfIP && cfIP.trim()) return cfIP.trim();

  const xff = headers.get('X-Forwarded-For');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  return null;
}
