/**
 * Customer email notifications via Resend REST API.
 * CF Worker compatible — uses fetch(), no SDK needed.
 *
 * Env vars:
 *   RESEND_API_KEY      — Resend API key
 *   RESEND_FROM_EMAIL   — Verified sender (e.g. noreply@cutebunny.co)
 */

const RESEND_API = 'https://api.resend.com/emails';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export interface SendResult {
  sent: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(
  apiKey: string,
  from: string,
  payload: EmailPayload,
): Promise<SendResult> {
  if (!apiKey || !from) {
    return { sent: false, error: 'Missing RESEND_API_KEY or RESEND_FROM_EMAIL' };
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { sent: false, error: `Resend ${res.status}: ${body}` };
    }

    const data = (await res.json()) as { id?: string };
    return { sent: true, id: data.id };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── i18n Email Templates ──────────────────────────────────────────────

interface OrderEmailData {
  orderNumber: string;
  customerName: string;
  items: Array<{ productName: string; size: string; quantity: number }>;
  totalAmount: number;
  rentalStartDate: string;
  rentalEndDate: string;
  totalDays: number;
}

const TRANSLATIONS = {
  th: {
    confirmSubject: 'ยืนยันการชำระเงิน — คำสั่งซื้อ {{orderNumber}}',
    confirmTitle: 'ชำระเงินสำเร็จ',
    confirmBody: 'ขอบคุณที่เช่ากับ CuteBunny Rental! การชำระเงินของคุณได้รับเรียบร้อยแล้ว',
    failedSubject: 'การชำระเงินไม่สำเร็จ — คำสั่งซื้อ {{orderNumber}}',
    failedTitle: 'การชำระเงินไม่สำเร็จ',
    failedBody: 'การชำระเงินสำหรับคำสั่งซื้อของคุณไม่สำเร็จ กรุณาลองอีกครั้ง',
    orderLabel: 'คำสั่งซื้อ',
    itemsLabel: 'รายการสินค้า',
    productLabel: 'สินค้า',
    sizeLabel: 'ขนาด',
    qtyLabel: 'จำนวน',
    totalLabel: 'ยอดรวม',
    rentalPeriod: 'ระยะเวลาเช่า',
    days: 'วัน',
    retryButton: 'ลองชำระเงินอีกครั้ง',
    currency: '฿',
  },
  en: {
    confirmSubject: 'Payment Confirmed — Order {{orderNumber}}',
    confirmTitle: 'Payment Successful',
    confirmBody: 'Thank you for renting with CuteBunny Rental! Your payment has been received.',
    failedSubject: 'Payment Failed — Order {{orderNumber}}',
    failedTitle: 'Payment Failed',
    failedBody: 'Your payment could not be processed. Please try again.',
    orderLabel: 'Order',
    itemsLabel: 'Items',
    productLabel: 'Product',
    sizeLabel: 'Size',
    qtyLabel: 'Qty',
    totalLabel: 'Total',
    rentalPeriod: 'Rental Period',
    days: 'days',
    retryButton: 'Retry Payment',
    currency: '฿',
  },
  zh: {
    confirmSubject: '付款确认 — 订单 {{orderNumber}}',
    confirmTitle: '付款成功',
    confirmBody: '感谢您使用 CuteBunny Rental！您的付款已收到。',
    failedSubject: '付款失败 — 订单 {{orderNumber}}',
    failedTitle: '付款失败',
    failedBody: '您的付款未能成功处理，请重试。',
    orderLabel: '订单',
    itemsLabel: '商品',
    productLabel: '商品',
    sizeLabel: '尺码',
    qtyLabel: '数量',
    totalLabel: '总计',
    rentalPeriod: '租赁期',
    days: '天',
    retryButton: '重新付款',
    currency: '฿',
  },
} as const;

type Locale = keyof typeof TRANSLATIONS;

function getT(locale: string): (typeof TRANSLATIONS)[Locale] {
  const key = (locale in TRANSLATIONS ? locale : 'th') as Locale;
  return TRANSLATIONS[key];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function itemsTable(
  items: OrderEmailData['items'],
  t: ReturnType<typeof getT>,
): string {
  const rows = items
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${item.productName}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${item.size}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${item.quantity}</td>
        </tr>`,
    )
    .join('');

  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead>
        <tr style="background:#f8f8f8">
          <th style="padding:8px 12px;text-align:left;font-size:13px">${t.productLabel}</th>
          <th style="padding:8px 12px;text-align:center;font-size:13px">${t.sizeLabel}</th>
          <th style="padding:8px 12px;text-align:center;font-size:13px">${t.qtyLabel}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
      <div style="background:#FF69B4;padding:24px;text-align:center">
        <h1 style="color:white;margin:0;font-size:20px">CuteBunny Rental</h1>
      </div>
      <div style="padding:24px">
        ${content}
      </div>
      <div style="padding:16px 24px;background:#f8f8f8;text-align:center;font-size:12px;color:#888">
        CuteBunny Rental &copy; ${new Date().getFullYear()}
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Public Template Builders ──────────────────────────────────────────

export function buildConfirmationEmail(
  locale: string,
  data: OrderEmailData,
): EmailPayload & { subject: string } {
  const t = getT(locale);

  const content = `
    <h2 style="color:#333;margin:0 0 8px">${t.confirmTitle}</h2>
    <p style="color:#666;margin:0 0 16px">${t.confirmBody}</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin:0 0 16px">
      <p style="margin:0;font-size:14px;color:#166534"><strong>${t.orderLabel}:</strong> ${data.orderNumber}</p>
      <p style="margin:4px 0 0;font-size:14px;color:#166534"><strong>${t.totalLabel}:</strong> ${t.currency}${data.totalAmount.toLocaleString()}</p>
      <p style="margin:4px 0 0;font-size:14px;color:#166534"><strong>${t.rentalPeriod}:</strong> ${formatDate(data.rentalStartDate)} – ${formatDate(data.rentalEndDate)} (${data.totalDays} ${t.days})</p>
    </div>
    <h3 style="color:#333;margin:0 0 8px;font-size:15px">${t.itemsLabel}</h3>
    ${itemsTable(data.items, t)}`;

  return {
    to: '', // filled by caller
    subject: t.confirmSubject.replace('{{orderNumber}}', data.orderNumber),
    html: baseLayout(content),
  };
}

export function buildFailedEmail(
  locale: string,
  data: Pick<OrderEmailData, 'orderNumber' | 'customerName' | 'totalAmount'>,
  retryUrl?: string,
): EmailPayload & { subject: string } {
  const t = getT(locale);

  const retryButton = retryUrl
    ? `<div style="text-align:center;margin:24px 0">
        <a href="${retryUrl}" style="display:inline-block;background:#FF69B4;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">${t.retryButton}</a>
      </div>`
    : '';

  const content = `
    <h2 style="color:#333;margin:0 0 8px">${t.failedTitle}</h2>
    <p style="color:#666;margin:0 0 16px">${t.failedBody}</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px;margin:0 0 16px">
      <p style="margin:0;font-size:14px;color:#991b1b"><strong>${t.orderLabel}:</strong> ${data.orderNumber}</p>
      <p style="margin:4px 0 0;font-size:14px;color:#991b1b"><strong>${t.totalLabel}:</strong> ${t.currency}${data.totalAmount.toLocaleString()}</p>
    </div>
    ${retryButton}`;

  return {
    to: '',
    subject: t.failedSubject.replace('{{orderNumber}}', data.orderNumber),
    html: baseLayout(content),
  };
}
