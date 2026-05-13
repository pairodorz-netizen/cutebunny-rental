/**
 * Customer PII masking helpers.
 *
 * CuteBunny soft-deletes customers by prefixing their email with
 * `deleted_<timestamp>_`. These helpers detect soft-deleted customers
 * and mask their PII to comply with right-to-be-forgotten.
 */

const DELETED_EMAIL_PREFIX = 'deleted_';

/** Returns true when the customer email indicates a soft-deleted record. */
export function isCustomerDeleted(email: string): boolean {
  return email.startsWith(DELETED_EMAIL_PREFIX);
}

export interface CustomerPII {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  address?: unknown;
}

export interface MaskedCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  address: unknown;
  _deleted: boolean;
}

/**
 * Returns masked PII fields if the customer is soft-deleted,
 * or the original fields if the customer is active.
 */
export function maskCustomerPII<T extends CustomerPII>(customer: T): T & { _deleted: boolean } {
  const deleted = isCustomerDeleted(customer.email);
  if (!deleted) {
    return { ...customer, _deleted: false };
  }
  return {
    ...customer,
    firstName: '[Deleted',
    lastName: 'customer]',
    email: '***@***',
    phone: '***-***-****',
    address: {},
    _deleted: true,
  };
}

/**
 * Builds a masked display name.
 * Active customer: "firstName lastName"
 * Deleted customer: "[Deleted customer]"
 */
export function customerDisplayName(firstName: string, lastName: string, email: string): string {
  if (isCustomerDeleted(email)) {
    return '[Deleted customer]';
  }
  return `${firstName} ${lastName}`;
}

/**
 * Mask phone for display. Returns '***-***-****' for deleted customers.
 */
export function customerDisplayPhone(phone: string | null, email: string): string | null {
  if (isCustomerDeleted(email)) {
    return '***-***-****';
  }
  return phone;
}

/**
 * Mask email for display. Returns '***@***' for deleted customers.
 */
export function customerDisplayEmail(email: string): string {
  if (isCustomerDeleted(email)) {
    return '***@***';
  }
  return email;
}
