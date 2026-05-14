/**
 * BUG-541 PII Audit: Verify all admin endpoints mask soft-deleted customer PII.
 *
 * Checks source code of admin route files to ensure every customer_name,
 * customer_phone, and customer count reference uses the shared masking
 * helpers instead of raw field access.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ADMIN_ROUTES = resolve(__dirname, '../routes/admin');

function readRoute(name: string): string {
  return readFileSync(resolve(ADMIN_ROUTES, name), 'utf-8');
}

describe('BUG-541 PII Audit: admin endpoints must mask deleted customer PII', () => {
  describe('dashboard.ts', () => {
    const src = readRoute('dashboard.ts');

    it('imports customerDisplayName from shared helper', () => {
      expect(src).toContain("import { customerDisplayName } from '@cutebunny/shared/customer-pii'");
    });

    it('recent_orders use customerDisplayName (not raw template)', () => {
      // Must NOT have raw `${o.customer.firstName} ${o.customer.lastName}` in customer_name
      const rawPattern = /customer_name:\s*`\$\{o\.customer\.firstName\}\s+\$\{o\.customer\.lastName\}`/;
      expect(rawPattern.test(src)).toBe(false);
    });

    it('recent_orders use customerDisplayName helper', () => {
      expect(src).toContain('customerDisplayName(o.customer.firstName, o.customer.lastName, o.customer.email)');
    });

    it('customer select includes email for masking', () => {
      // All customer selects must include email
      const customerSelects = src.match(/customer:\s*\{\s*select:\s*\{[^}]+\}/g) ?? [];
      for (const sel of customerSelects) {
        expect(sel).toContain('email');
      }
    });

    it('totalCustomers count excludes soft-deleted (email filter)', () => {
      expect(src).toContain("startsWith: 'deleted_'");
    });
  });

  describe('products.ts', () => {
    const src = readRoute('products.ts');

    it('imports customerDisplayName and customerDisplayPhone', () => {
      expect(src).toContain("customerDisplayName");
      expect(src).toContain("customerDisplayPhone");
    });

    it('rental_history customer_name uses customerDisplayName', () => {
      expect(src).toContain('customerDisplayName(oi.order.customer.firstName, oi.order.customer.lastName, oi.order.customer.email)');
    });

    it('rental_history customer_phone uses customerDisplayPhone', () => {
      expect(src).toContain('customerDisplayPhone(oi.order.customer.phone, oi.order.customer.email)');
    });

    it('product detail customer select includes email', () => {
      const rentalHistorySelect = src.match(/customer:\s*\{\s*select:\s*\{[^}]*firstName[^}]*\}/g) ?? [];
      for (const sel of rentalHistorySelect) {
        expect(sel).toContain('email');
      }
    });
  });

  describe('shipping.ts', () => {
    const src = readRoute('shipping.ts');

    it('imports customerDisplayName and customerDisplayPhone', () => {
      expect(src).toContain("customerDisplayName");
      expect(src).toContain("customerDisplayPhone");
    });

    it('recipient fallback uses customerDisplayName', () => {
      expect(src).toContain('customerDisplayName(order.customer.firstName, order.customer.lastName, order.customer.email)');
    });

    it('recipient phone fallback uses customerDisplayPhone', () => {
      expect(src).toContain('customerDisplayPhone(order.customer.phone, order.customer.email)');
    });
  });

  describe('orders.ts', () => {
    const src = readRoute('orders.ts');

    it('imports all masking helpers', () => {
      expect(src).toContain('customerDisplayName');
      expect(src).toContain('customerDisplayEmail');
      expect(src).toContain('customerDisplayPhone');
      expect(src).toContain('isCustomerDeleted');
    });

    it('order list customer_name uses customerDisplayName', () => {
      // The list mapping should use helper
      const listMatch = src.match(/name:\s*customerDisplayName\(o\.customer/g);
      expect(listMatch).not.toBeNull();
      expect(listMatch!.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('customers.ts', () => {
    const src = readRoute('customers.ts');

    it('customer list filters out soft-deleted emails', () => {
      expect(src).toContain("NOT LIKE 'deleted_%'");
    });

    it('customer detail masks PII via isCustomerDeleted', () => {
      expect(src).toContain('isCustomerDeleted(customer.email)');
    });

    it('credit adjustment note uses customerDisplayName', () => {
      expect(src).toContain('customerDisplayName(customer.firstName, customer.lastName, customer.email)');
    });
  });
});
