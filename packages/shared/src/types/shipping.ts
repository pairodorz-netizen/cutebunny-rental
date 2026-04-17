export type ShippingMethod = 'standard' | 'express' | 'pickup';

export type ShipmentStatus =
  | 'preparing'
  | 'shipped'
  | 'in_transit'
  | 'delivered'
  | 'return_shipped'
  | 'return_received';

export interface ShippingOption {
  id: string;
  method: ShippingMethod;
  name: string;
  description: string;
  price: number;
  estimatedDays: number;
  available: boolean;
}

export interface Shipment {
  id: string;
  orderId: string;
  method: ShippingMethod;
  status: ShipmentStatus;
  trackingNumber?: string;
  carrier?: string;
  estimatedDeliveryDate?: string;
  actualDeliveryDate?: string;
  returnTrackingNumber?: string;
  returnCarrier?: string;
  createdAt: string;
  updatedAt: string;
}
