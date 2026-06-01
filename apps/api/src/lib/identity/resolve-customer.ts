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
    // Step 2: update last_used_at + lastLoginAt
    const now = new Date();
    await db.customerIdentity.update({
      where: { id: existing.id },
      data: { lastUsedAt: now },
    });
    await db.customer.update({
      where: { id: existing.customerId },
      data: { lastLoginAt: now },
    });
    return { customerId: existing.customerId, created: false };
  }

  // Step 3: LINE provider — cross-check existing customers before creating new
  if (provider === 'line') {
    // 3a: Check lineUserId cache column (safety net for orphaned cache)
    if (profile.lineUserId) {
      const byCache = await db.customer.findUnique({
        where: { lineUserId: profile.lineUserId },
        select: { id: true },
      });
      if (byCache) {
        await db.customerIdentity.create({
          data: {
            customerId: byCache.id,
            provider,
            providerSubject,
            verificationMethod,
            verifiedAt: new Date(),
            lastUsedAt: new Date(),
          },
        });
        return { customerId: byCache.id, created: false };
      }
    }

    // 3b: If LINE returned an email, check if a customer exists with that email
    if (profile.email && !profile.email.endsWith('@placeholder.local')) {
      const byEmail = await db.customer.findUnique({
        where: { email: profile.email },
        select: { id: true },
      });
      if (byEmail) {
        await db.customerIdentity.create({
          data: {
            customerId: byEmail.id,
            provider,
            providerSubject,
            verificationMethod,
            verifiedAt: new Date(),
            lastUsedAt: new Date(),
          },
        });
        // Also set LINE cache columns on the matched customer
        await db.customer.update({
          where: { id: byEmail.id },
          data: {
            lineUserId: profile.lineUserId,
            lineDisplayName: profile.displayName,
            linePictureUrl: profile.linePictureUrl,
          },
        });
        return { customerId: byEmail.id, created: false };
      }
    }
  }

  // Step 4: create customer + identity in a transaction
  try {
    const result = await db.$transaction(async (tx) => {
      const customerData: Record<string, unknown> = {
        source: 'storefront',
        status: 'active',
        lastLoginAt: new Date(),
      };

      if (profile.displayName) customerData.displayName = profile.displayName;
      if (profile.email) customerData.primaryEmail = profile.email;
      if (profile.phone) customerData.primaryPhoneE164 = profile.phone;

      if (provider === 'line') {
        if (profile.lineUserId) customerData.lineUserId = profile.lineUserId;
        if (profile.displayName) customerData.lineDisplayName = profile.displayName;
        if (profile.linePictureUrl) customerData.linePictureUrl = profile.linePictureUrl;
        customerData.firstName = profile.displayName ?? 'LINE User';
        customerData.lastName = '';
        customerData.email = `line_${providerSubject}@placeholder.local`;
      } else {
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
