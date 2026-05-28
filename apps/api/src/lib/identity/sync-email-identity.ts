import type { PrismaClient } from '@prisma/client';
import { resolveCustomer } from './resolve-customer';

interface SyncEmailInput {
  customerId: string;
  email: string;
  isSignUp: boolean;
}

/**
 * After a successful email/password sign-in or sign-up, ensure the customer
 * has a customer_identities row for provider='email'. Idempotent.
 */
export async function syncEmailIdentity(
  db: PrismaClient,
  input: SyncEmailInput,
): Promise<{ customerId: string; created: boolean }> {
  const { customerId, email, isSignUp } = input;

  // Check if an email identity already exists for this customer
  const existing = await db.customerIdentity.findFirst({
    where: { customerId, provider: 'email' },
  });

  if (existing) {
    await db.customerIdentity.update({
      where: { id: existing.id },
      data: { lastUsedAt: new Date() },
    });
    return { customerId, created: false };
  }

  // Create identity row
  await db.customerIdentity.create({
    data: {
      customerId,
      provider: 'email',
      providerSubject: customerId, // use customer.id as the stable subject
      verificationMethod: 'email_password',
      verifiedAt: new Date(),
      lastUsedAt: new Date(),
    },
  });

  // Update primary_email on customer if not set
  await db.customer.update({
    where: { id: customerId },
    data: { primaryEmail: email },
  });

  // On sign-up, record PDPA consent
  if (isSignUp) {
    const privacyVersion = typeof process !== 'undefined'
      ? process.env.PRIVACY_NOTICE_VERSION ?? '2026-05-v1'
      : '2026-05-v1';

    await db.customerConsent.create({
      data: {
        customerId,
        purpose: 'privacy_notice',
        channel: 'website',
        status: 'accepted',
        noticeVersion: privacyVersion,
      },
    });
  }

  return { customerId, created: true };
}

/**
 * For new LINE-only customers, resolve and create via resolveCustomer.
 * Called from the LINE callback handler.
 */
export async function syncLineIdentity(
  db: PrismaClient,
  input: {
    lineUserId: string;
    displayName: string;
    pictureUrl?: string;
  },
): Promise<{ customerId: string; created: boolean }> {
  const result = await resolveCustomer(db, {
    provider: 'line',
    providerSubject: input.lineUserId,
    profile: {
      displayName: input.displayName,
      lineUserId: input.lineUserId,
      linePictureUrl: input.pictureUrl,
    },
    verificationMethod: 'line_login',
  });

  // Update LINE cache columns on the customer
  await db.customer.update({
    where: { id: result.customerId },
    data: {
      lineUserId: input.lineUserId,
      lineDisplayName: input.displayName,
      linePictureUrl: input.pictureUrl ?? undefined,
    },
  });

  // On first creation, record PDPA consent
  if (result.created) {
    const privacyVersion = typeof process !== 'undefined'
      ? process.env.PRIVACY_NOTICE_VERSION ?? '2026-05-v1'
      : '2026-05-v1';

    await db.customerConsent.create({
      data: {
        customerId: result.customerId,
        purpose: 'privacy_notice',
        channel: 'website',
        status: 'accepted',
        noticeVersion: privacyVersion,
      },
    });
  }

  return result;
}
