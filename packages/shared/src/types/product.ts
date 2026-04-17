export interface Product {
  id: string;
  name: string;
  description: string;
  category: ProductCategory;
  size: string[];
  color: string[];
  rentalPricePerDay: number;
  retailPrice: number;
  currency: string;
  images: string[];
  thumbnailUrl: string;
  available: boolean;
  stockQuantity: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type ProductCategory =
  | 'wedding'
  | 'evening'
  | 'cocktail'
  | 'casual'
  | 'costume'
  | 'traditional'
  | 'accessories';

export interface ProductFilter {
  category?: ProductCategory;
  minPrice?: number;
  maxPrice?: number;
  size?: string;
  color?: string;
  available?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
