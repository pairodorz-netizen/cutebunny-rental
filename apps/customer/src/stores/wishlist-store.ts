import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WishlistState {
  ids: string[];
  toggle: (productId: string) => void;
  has: (productId: string) => boolean;
  count: () => number;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (productId) =>
        set((state) => ({
          ids: state.ids.includes(productId)
            ? state.ids.filter((id) => id !== productId)
            : [...state.ids, productId],
        })),
      has: (productId) => get().ids.includes(productId),
      count: () => get().ids.length,
    }),
    { name: 'cb-wishlist' },
  ),
);
