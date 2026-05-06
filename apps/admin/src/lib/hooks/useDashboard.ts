import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';

const REFRESH_INTERVAL = 30_000;
const STALE_TIME = 15_000;

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => adminApi.dashboard.stats(),
    refetchInterval: REFRESH_INTERVAL,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardOverview() {
  return useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => adminApi.dashboard.overview(),
    refetchInterval: REFRESH_INTERVAL,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardLowStock(limit = 10) {
  return useQuery({
    queryKey: ['dashboard-low-stock', limit],
    queryFn: () => adminApi.dashboard.lowStock(limit),
    refetchInterval: REFRESH_INTERVAL,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => adminApi.dashboard.summary(),
    refetchInterval: REFRESH_INTERVAL,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: true,
  });
}
