/**
 * BUG-549: Shared P/L (Profit & Loss) calculation helper.
 *
 * Single source of truth for product-level P/L across:
 *   - /admin/products (list view)
 *   - /admin/products/:id/detail (product detail P&L tab)
 *   - /admin/products/:id/roi (per-product ROI)
 *   - /admin/products/roi/summary (ROI rankings)
 *   - /admin/finance/summary (period breakdown)
 *
 * Formula:
 *   gross_profit = total_rental_revenue - total_variable_cost
 *   net_pl       = total_rental_revenue - buying_cost - total_variable_cost + selling_price
 *
 * Where:
 *   total_rental_revenue = sum of order_item.subtotal for paid orders
 *   total_variable_cost  = variable_cost_per_rental × rental_count
 *   buying_cost          = product.costPrice (one-time purchase cost)
 *   selling_price        = product.sellingPrice (recovery if sold, 0 otherwise)
 */

export const PAID_ORDER_STATUSES = [
  'paid_locked',
  'shipped',
  'returned',
  'repair',
  'finished',
] as const;

export const REVENUE_TX_TYPES = [
  'rental_revenue',
  'late_fee',
  'damage_fee',
  'force_buy',
  'deposit_forfeited',
] as const;

export const EXPENSE_TX_TYPES = [
  'repair',
  'cogs',
  'shipping',
] as const;

export interface OrderItemForPL {
  subtotal: number;
  order: { status: string };
}

export interface ProductPLInput {
  costPrice: number;
  sellingPrice: number;
  variableCost: number | null;
  orderItems: OrderItemForPL[];
}

export interface ProductPLResult {
  buying_cost: number;
  total_rental_revenue: number;
  rental_count: number;
  variable_cost_per_rental: number;
  total_variable_cost: number;
  selling_price: number;
  gross_profit: number;
  net_pl: number;
}

/**
 * Compute P/L for a single product from its order items.
 * This is the canonical formula — all views must use this.
 */
export function computeProductPL(input: ProductPLInput): ProductPLResult {
  const paidItems = input.orderItems.filter((oi) =>
    (PAID_ORDER_STATUSES as readonly string[]).includes(oi.order.status),
  );
  const totalRentalRevenue = paidItems.reduce((sum, oi) => sum + oi.subtotal, 0);
  const rentalCount = paidItems.length;
  const variableCostPerRental = input.variableCost ?? 0;
  const totalVariableCost = variableCostPerRental * rentalCount;
  const buyingCost = input.costPrice;
  const sellingPrice = input.sellingPrice;

  return {
    buying_cost: buyingCost,
    total_rental_revenue: totalRentalRevenue,
    rental_count: rentalCount,
    variable_cost_per_rental: variableCostPerRental,
    total_variable_cost: totalVariableCost,
    selling_price: sellingPrice,
    gross_profit: totalRentalRevenue - totalVariableCost,
    net_pl: totalRentalRevenue - buyingCost - totalVariableCost + sellingPrice,
  };
}

export interface FinanceTxForROI {
  txType: string;
  amount: number;
}

export interface ProductROIInput {
  costPrice: number;
  variableCost: number | null;
  orderItems: Array<{ subtotal: number; order: { status: string } }>;
  financeTransactions: FinanceTxForROI[];
}

export interface ProductROIResult {
  purchase_cost: number;
  total_revenue: number;
  total_expenses: number;
  net_profit: number;
  roi: number;
  total_rentals: number;
  revenue_per_rental: number;
  break_even_rentals: number;
}

/**
 * Compute ROI for a single product using finance transactions.
 * Falls back to order item subtotals when no finance transactions exist.
 */
export function computeProductROI(input: ProductROIInput): ProductROIResult {
  const purchaseCost = input.costPrice;
  const paidOrders = input.orderItems.filter((oi) =>
    (PAID_ORDER_STATUSES as readonly string[]).includes(oi.order.status),
  );
  const totalRentals = paidOrders.length;
  const variableCostPerRental = input.variableCost ?? 0;
  const totalVariableCost = variableCostPerRental * totalRentals;

  let totalRevenue = 0;
  let totalExpenses = 0;

  for (const tx of input.financeTransactions) {
    if ((REVENUE_TX_TYPES as readonly string[]).includes(tx.txType)) {
      totalRevenue += tx.amount;
    } else if ((EXPENSE_TX_TYPES as readonly string[]).includes(tx.txType)) {
      totalExpenses += Math.abs(tx.amount);
    }
  }

  // Fallback: if no product-linked finance transactions, estimate from order subtotals
  if (totalRevenue === 0 && totalRentals > 0) {
    totalRevenue = paidOrders.reduce((sum, oi) => sum + oi.subtotal, 0);
  }

  // Include variable cost in expenses
  totalExpenses += totalVariableCost;

  const netProfit = totalRevenue - totalExpenses - purchaseCost;
  const roi = purchaseCost > 0 ? ((totalRevenue - totalExpenses - purchaseCost) / purchaseCost) * 100 : 0;
  const revenuePerRental = totalRentals > 0 ? Math.round(totalRevenue / totalRentals) : 0;
  const breakEvenRentals = revenuePerRental > 0 ? Math.ceil(purchaseCost / revenuePerRental) : 0;

  return {
    purchase_cost: purchaseCost,
    total_revenue: totalRevenue,
    total_expenses: totalExpenses,
    net_profit: netProfit,
    roi: Math.round(roi * 100) / 100,
    total_rentals: totalRentals,
    revenue_per_rental: revenuePerRental,
    break_even_rentals: breakEvenRentals,
  };
}
