import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';

export function useAdminStats() {
  const query = useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => api.getAdminStats(),
  });

  return {
    stats: query.data?.stats ?? null,
    panelHealth: query.data?.panelHealth ?? null,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  };
}
