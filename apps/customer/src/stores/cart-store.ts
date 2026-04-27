import { create } from 'zustand';

export interface CartItem {
  product_id: string;
  product_name: string;
  thumbnail: string | null;
  rental_days: number;
  rental_start: string;
  price_per_day: number;
  subtotal: number;
  deposit: number;
  size: string;
}

export type DeliveryMethodType = 'standard' | 'messenger';

interface CartState {
  items: CartItem[];
  cartToken: string | null;
  deliveryMethod: DeliveryMethodType;
  messengerFeeSend: number;
  messengerFeeReturn: number;
  messengerDistanceKm: number | null;
  customerCoords: { lat: number; lng: number } | null;
  addItem: (item: CartItem) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  setCartToken: (token: string) => void;
  setDeliveryMethod: (method: DeliveryMethodType) => void;
  setMessengerFees: (send: number, ret: number, distanceKm: number | null) => void;
  setCustomerCoords: (coords: { lat: number; lng: number } | null) => void;
  getTotal: () => { subtotal: number; deposit: number; total: number };
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  cartToken: null,
  deliveryMethod: 'standard',
  messengerFeeSend: 0,
  messengerFeeReturn: 0,
  messengerDistanceKm: null,
  customerCoords: null,
  addItem: (item) => {
    set((state) => {
      const existing = state.items.findIndex((i) => i.product_id === item.product_id);
      if (existing >= 0) {
        const newItems = [...state.items];
        newItems[existing] = item;
        return { items: newItems };
      }
      return { items: [...state.items, item] };
    });
  },
  removeItem: (productId) => {
    set((state) => ({
      items: state.items.filter((i) => i.product_id !== productId),
    }));
  },
  clearCart: () => set({
    items: [],
    cartToken: null,
    deliveryMethod: 'standard',
    messengerFeeSend: 0,
    messengerFeeReturn: 0,
    messengerDistanceKm: null,
    customerCoords: null,
  }),
  setCartToken: (token) => set({ cartToken: token }),
  setDeliveryMethod: (method) => set({ deliveryMethod: method }),
  setMessengerFees: (send, ret, distanceKm) =>
    set({ messengerFeeSend: send, messengerFeeReturn: ret, messengerDistanceKm: distanceKm }),
  setCustomerCoords: (coords) => set({ customerCoords: coords }),
  getTotal: () => {
    const items = get().items;
    const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
    const deposit = items.reduce((sum, i) => sum + i.deposit, 0);
    return { subtotal, deposit, total: subtotal + deposit };
  },
}));
