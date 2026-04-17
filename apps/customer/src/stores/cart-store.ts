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

interface CartState {
  items: CartItem[];
  cartToken: string | null;
  addItem: (item: CartItem) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  setCartToken: (token: string) => void;
  getTotal: () => { subtotal: number; deposit: number; total: number };
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  cartToken: null,
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
  clearCart: () => set({ items: [], cartToken: null }),
  setCartToken: (token) => set({ cartToken: token }),
  getTotal: () => {
    const items = get().items;
    const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
    const deposit = items.reduce((sum, i) => sum + i.deposit, 0);
    return { subtotal, deposit, total: subtotal + deposit };
  },
}));
