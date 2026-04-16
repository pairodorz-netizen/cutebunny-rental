export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'returned'
  | 'cancelled'
  | 'overdue';

export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed';

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  size: string;
  quantity: number;
  rentalPricePerDay: number;
  subtotal: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  items: OrderItem[];
  rentalStartDate: string;
  rentalEndDate: string;
  totalDays: number;
  subtotal: number;
  deposit: number;
  deliveryFee: number;
  discount: number;
  totalAmount: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  shippingAddressId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderFilter {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface OrderListResponse {
  items: Order[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
