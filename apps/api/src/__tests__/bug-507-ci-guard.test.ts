/**
 * BUG-507 — CI guard tests for PII/GDPR compliance.
 *
 * 1. IP redaction middleware works correctly
 * 2. gitleaks config exists with IP pattern rules
 * 3. Schema migration exists for INET type
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { redactIPFields } from '../lib/ip-redact';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

// ─── IP Redaction Tests ─────────────────────────────────────────────────

describe('BUG-507: IP redaction middleware', () => {
  it('redacts ip_address field', () => {
    const input = { user: 'admin', ip_address: '192.168.1.100', action: 'login' };
    const result = redactIPFields(input);
    expect(result.ip_address).toBe('[REDACTED]');
    expect(result.user).toBe('admin');
    expect(result.action).toBe('login');
  });

  it('redacts ipAddress field', () => {
    const input = { ipAddress: '10.0.0.5' };
    expect(redactIPFields(input).ipAddress).toBe('[REDACTED]');
  });

  it('redacts client_ip field', () => {
    const input = { client_ip: '172.16.0.1' };
    expect(redactIPFields(input).client_ip).toBe('[REDACTED]');
  });

  it('redacts ip field', () => {
    const input = { ip: '8.8.8.8' };
    expect(redactIPFields(input).ip).toBe('[REDACTED]');
  });

  it('does NOT redact masked_ip field', () => {
    const input = { masked_ip: '192.168.1.0/24' };
    expect(redactIPFields(input).masked_ip).toBe('192.168.1.0/24');
  });

  it('redacts nested IP fields', () => {
    const input = { data: { ip_address: '1.2.3.4', name: 'test' } };
    const result = redactIPFields(input);
    expect(result.data.ip_address).toBe('[REDACTED]');
    expect(result.data.name).toBe('test');
  });

  it('handles arrays', () => {
    const input = [{ ip_address: '1.1.1.1' }, { ip_address: '2.2.2.2' }];
    const result = redactIPFields(input);
    expect(result[0].ip_address).toBe('[REDACTED]');
    expect(result[1].ip_address).toBe('[REDACTED]');
  });

  it('handles null/undefined gracefully', () => {
    expect(redactIPFields(null)).toBeNull();
    expect(redactIPFields(undefined)).toBeUndefined();
  });

  it('handles primitive values', () => {
    expect(redactIPFields('string')).toBe('string');
    expect(redactIPFields(42)).toBe(42);
  });
});

// ─── gitleaks config guard ──────────────────────────────────────────────

describe('BUG-507: gitleaks config', () => {
  it('.gitleaks.toml exists at repo root', () => {
    expect(existsSync(join(REPO_ROOT, '.gitleaks.toml'))).toBe(true);
  });

  it('contains raw-ipv4-address rule', () => {
    const content = readFileSync(join(REPO_ROOT, '.gitleaks.toml'), 'utf-8');
    expect(content).toContain('raw-ipv4-address');
    expect(content).toContain('pii');
  });
});

// ─── INET migration guard ───────────────────────────────────────────────

describe('BUG-507: INET migration', () => {
  const migDir = join(REPO_ROOT, 'packages', 'shared', 'prisma', 'migrations', '20260508_150_audit_logs_ip_inet');

  it('migration directory exists', () => {
    expect(existsSync(migDir)).toBe(true);
  });

  it('migration SQL converts to inet type', () => {
    const sql = readFileSync(join(migDir, 'migration.sql'), 'utf-8');
    expect(sql).toContain('inet');
    expect(sql).toContain('ALTER');
    expect(sql).toContain('audit_logs');
  });

  it('schema.prisma uses @db.Inet for ipAddress', () => {
    const schema = readFileSync(
      join(REPO_ROOT, 'packages', 'shared', 'prisma', 'schema.prisma'),
      'utf-8',
    );
    expect(schema).toContain('@db.Inet');
    expect(schema).toContain('ipAddress');
  });
});
