import type { PrismaClient } from '@prisma/client';

export interface CustomerProfile {
  email?: string;
  displayName?: string;
  lineUserId?: string;
  linePictureUrl?: string;
  phone?: string;
}

export interface ResolveCustomerInput {
  provider: 'email' | 'line' | 'admin_manual';
  providerSubject: string;
  profile: CustomerProfile;
  verificationMethod: 'email_password' | 'line_login' | 'admin_create' | 'admin_merge';
}

export interface ResolveCustomerResult {
  customerId: string;
  created: boolean;
}

/**
 * Find-or-create a customer + identity row.
 * MVP: exact (provider, provider_subject) match only — no soft-matching.
 */
export async function resolveCustomer(
  db: PrismaClient,
  input: ResolveCustomerInput,
): Promise<ResolveCustomerResult> {
  const { provider, providerSubject, profile, verificationMethod } = input;

  // Step 1: look for existing identity
  const existing = await db.customerIdentity.findUnique({
    where: { provider_providerSubject: { provider, providerSubject } },
  });

  if (existing) {
    // Step 2: update last_used_at
    await db.customerIdentity.update({
      where: { id: existing.id },
      data: { lastUsedAt: new Date() },
    });
    return { customerId: existing.customerId, created: false };
  }

  // Step 3: create customer + identity in a transaction
  try {
    const result = await db.$transaction(async (tx) => {
      const customerData: Record<string, unknown> = {
        source: 'storefront',
        status: 'active',
      };

      if (profile.displayName) customerData.displayName = profile.displayName;
      if (profile.email) customerData.primaryEmail = profile.email;
      if (profile.phone) customerData.primaryPhoneE164 = profile.phone;

      if (provider === 'line') {
        if (profile.lineUserId) customerData.lineUserId = profile.lineUserId;
        if (profile.displayName) customerData.lineDisplayName = profile.displayName;
        if (profile.linePictureUrl) customerData.linePictureUrl = profile.linePictureUrl;
        // LINE-only customers: use display name as first/last, email placeholder
        customerData.firstName = profile.displayName ?? 'LINE User';
        customerData.lastName = '';
        customerData.email = `line_${providerSubject}@placeholder.local`;
      } else {
        // email provider: use email as-is
        customerData.firstName = profile.displayName ?? '';
        customerData.lastName = '';
        customerData.email = profile.email ?? `${providerSubject}@placeholder.local`;
      }

      const customer = await tx.customer.create({
        data: customerData as Parameters<typeof tx.customer.create>[0]['data'],
      });

      await tx.customerIdentity.create({
        data: {
          customerId: customer.id,
          provider,
          providerSubject,
          verificationMethod,
          verifiedAt: new Date(),
          lastUsedAt: new Date(),
        },
      });

      return { customerId: customer.id, created: true };
    });

    return result;
  } catch (err: unknown) {
    // Step 4: on unique-constraint conflict (race), re-run step 1
    const prismaError = err as { code?: string };
    if (prismaError.code === 'P2002') {
      const retried = await db.customerIdentity.findUnique({
        where: { provider_providerSubject: { provider, providerSubject } },
      });
      if (retried) {
        return { customerId: retried.customerId, created: false };
      }
    }
    throw err;
  }
}
