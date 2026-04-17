import { getDb } from './db';

interface NotificationPayload {
  orderId?: string;
  customerId?: string;
  channel: 'email' | 'line' | 'sms';
  recipient: string;
  subject?: string;
  body: string;
}

const ORDER_STATUS_MESSAGES: Record<string, { subject: string; template: (orderNumber: string, extra?: string) => string }> = {
  paid_locked: {
    subject: 'Payment Confirmed',
    template: (orderNumber) =>
      `Your payment for order ${orderNumber} has been confirmed. We are preparing your dress for shipping.`,
  },
  shipped: {
    subject: 'Order Shipped',
    template: (orderNumber, tracking) =>
      `Your order ${orderNumber} has been shipped!${tracking ? ` Tracking: ${tracking}` : ''} Thank you for choosing CuteBunny Rental!`,
  },
  returned: {
    subject: 'Return Received',
    template: (orderNumber) =>
      `We have received the return for order ${orderNumber}. Your items are being inspected. Your deposit will be processed soon.`,
  },
  ready: {
    subject: 'Order Complete',
    template: (orderNumber) =>
      `Order ${orderNumber} is complete. Your deposit refund is being processed. Thank you for renting with CuteBunny!`,
  },
};

export async function sendOrderStatusNotification(
  orderId: string,
  orderNumber: string,
  toStatus: string,
  customerEmail: string,
  customerId: string,
  trackingNumber?: string,
): Promise<void> {
  const db = getDb();
  const messageConfig = ORDER_STATUS_MESSAGES[toStatus];

  if (!messageConfig) return; // No notification for this status

  const body = messageConfig.template(orderNumber, trackingNumber);

  // Log the notification (actual sending via SMTP/LINE API would be added here)
  await db.notificationLog.create({
    data: {
      orderId,
      customerId,
      channel: 'email',
      recipient: customerEmail,
      subject: messageConfig.subject,
      body,
      status: 'sent', // In production, this would be 'pending' until confirmed
    },
  });
}

export async function sendCustomNotification(payload: NotificationPayload): Promise<{ id: string }> {
  const db = getDb();

  const log = await db.notificationLog.create({
    data: {
      orderId: payload.orderId,
      customerId: payload.customerId,
      channel: payload.channel,
      recipient: payload.recipient,
      subject: payload.subject,
      body: payload.body,
      status: 'sent',
    },
  });

  return { id: log.id };
}
