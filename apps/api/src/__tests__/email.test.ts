/**
 * Email module tests.
 *
 * Covers:
 * - sendEmail: Resend REST API integration
 * - buildConfirmationEmail: i18n templates (TH, EN, ZH)
 * - buildFailedEmail: i18n templates (TH, EN, ZH)
 * - Edge cases: missing env vars, API errors, unknown locale fallback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail, buildConfirmationEmail, buildFailedEmail } from '../lib/email';

// ─── Mock fetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── Test Data ─────────────────────────────────────────────────────────

const orderData = {
  orderNumber: 'ORD-20260513',
  customerName: 'สมชาย ใจดี',
  items: [
    { productName: 'ชุดกระต่ายน้อย', size: 'M', quantity: 1 },
    { productName: 'หมวกกระต่าย', size: 'Free', quantity: 2 },
  ],
  totalAmount: 1500,
  rentalStartDate: '2026-05-15',
  rentalEndDate: '2026-05-20',
  totalDays: 5,
};

// ─── sendEmail ─────────────────────────────────────────────────────────

describe('sendEmail', () => {
  it('sends email via Resend API and returns id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'email_abc123' }),
    });

    const result = await sendEmail('re_test_key', 'noreply@test.com', {
      to: 'customer@test.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.sent).toBe(true);
    expect(result.id).toBe('email_abc123');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer re_test_key');

    const body = JSON.parse(opts.body);
    expect(body.from).toBe('noreply@test.com');
    expect(body.to).toBe('customer@test.com');
    expect(body.subject).toBe('Test');
  });

  it('returns error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    const result = await sendEmail('re_test_key', 'noreply@test.com', {
      to: 'customer@test.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.sent).toBe(false);
    expect(result.error).toContain('403');
  });

  it('returns error when missing API key', async () => {
    const result = await sendEmail('', 'noreply@test.com', {
      to: 'customer@test.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.sent).toBe(false);
    expect(result.error).toContain('Missing');
  });

  it('returns error when missing from email', async () => {
    const result = await sendEmail('re_test_key', '', {
      to: 'customer@test.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.sent).toBe(false);
    expect(result.error).toContain('Missing');
  });

  it('handles network error gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await sendEmail('re_test_key', 'noreply@test.com', {
      to: 'customer@test.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.sent).toBe(false);
    expect(result.error).toBe('Network error');
  });
});

// ─── buildConfirmationEmail (TH) ───────────────────────────────────────

describe('buildConfirmationEmail', () => {
  it('builds Thai confirmation email', () => {
    const email = buildConfirmationEmail('th', orderData);

    expect(email.subject).toContain('ORD-20260513');
    expect(email.subject).toContain('ยืนยันการชำระเงิน');
    expect(email.html).toContain('ชำระเงินสำเร็จ');
    expect(email.html).toContain('CuteBunny Rental');
    expect(email.html).toContain('ชุดกระต่ายน้อย');
    expect(email.html).toContain('หมวกกระต่าย');
    expect(email.html).toContain('1,500');
    expect(email.html).toContain('5 วัน');
    expect(email.html).toContain('฿');
  });

  it('builds English confirmation email', () => {
    const email = buildConfirmationEmail('en', orderData);

    expect(email.subject).toContain('Payment Confirmed');
    expect(email.subject).toContain('ORD-20260513');
    expect(email.html).toContain('Payment Successful');
    expect(email.html).toContain('5 days');
    expect(email.html).toContain('Product');
    expect(email.html).toContain('Size');
    expect(email.html).toContain('Qty');
  });

  it('builds Chinese confirmation email', () => {
    const email = buildConfirmationEmail('zh', orderData);

    expect(email.subject).toContain('付款确认');
    expect(email.html).toContain('付款成功');
    expect(email.html).toContain('5 天');
  });

  it('falls back to Thai for unknown locale', () => {
    const email = buildConfirmationEmail('ja', orderData);

    expect(email.subject).toContain('ยืนยันการชำระเงิน');
    expect(email.html).toContain('ชำระเงินสำเร็จ');
  });

  it('includes all item rows in table', () => {
    const email = buildConfirmationEmail('th', orderData);
    const trCount = (email.html.match(/<tr/g) || []).length;
    // 1 header row + 2 item rows = at least 3 <tr tags
    expect(trCount).toBeGreaterThanOrEqual(3);
  });
});

// ─── buildFailedEmail ──────────────────────────────────────────────────

describe('buildFailedEmail', () => {
  const failedData = {
    orderNumber: 'ORD-20260513',
    customerName: 'สมชาย ใจดี',
    totalAmount: 1500,
  };

  it('builds Thai failure email', () => {
    const email = buildFailedEmail('th', failedData);

    expect(email.subject).toContain('ไม่สำเร็จ');
    expect(email.subject).toContain('ORD-20260513');
    expect(email.html).toContain('การชำระเงินไม่สำเร็จ');
    expect(email.html).toContain('1,500');
  });

  it('builds English failure email', () => {
    const email = buildFailedEmail('en', failedData);

    expect(email.subject).toContain('Payment Failed');
    expect(email.html).toContain('could not be processed');
  });

  it('builds Chinese failure email', () => {
    const email = buildFailedEmail('zh', failedData);

    expect(email.subject).toContain('付款失败');
    expect(email.html).toContain('请重试');
  });

  it('includes retry button when URL provided', () => {
    const email = buildFailedEmail('th', failedData, 'https://cutebunny.co/retry/123');

    expect(email.html).toContain('https://cutebunny.co/retry/123');
    expect(email.html).toContain('ลองชำระเงินอีกครั้ง');
  });

  it('omits retry button when no URL', () => {
    const email = buildFailedEmail('th', failedData);

    expect(email.html).not.toContain('ลองชำระเงินอีกครั้ง');
  });

  it('falls back to Thai for unknown locale', () => {
    const email = buildFailedEmail('ko', failedData);

    expect(email.subject).toContain('ไม่สำเร็จ');
  });
});
