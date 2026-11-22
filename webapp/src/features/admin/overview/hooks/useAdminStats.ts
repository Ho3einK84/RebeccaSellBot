import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';

export function useAdminStats() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => api.getAdminStats(),
  });

  const forceRefresh = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.stats,
        queryFn: () => api.getAdminStats({ refresh: true }),
      }),
    [queryClient]
  );

  return {
    stats: query.data?.stats ?? null,
    panelHealth: query.data?.panelHealth ?? null,
    dbLatencyMs: query.data?.dbLatencyMs,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
    forceRefresh,
  };
}
