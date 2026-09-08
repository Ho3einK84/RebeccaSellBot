import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type { AdjustBalancePayload, UserDossierResponse } from '@/shared/types/api.js';

export function useAdminUsers() {
  const queryClient = useQueryClient();
  const { triggerHaptic } = useHaptic();

  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [inspectingId, setInspectingId] = useState<number | null>(null);

  const usersQuery = useQuery({
    queryKey: queryKeys.users(page, activeSearch),
    queryFn: () => api.getAdminUsers({ page, limit: 12, search: activeSearch }),
  });

  const dossierQuery = useQuery({
    queryKey: inspectingId ? queryKeys.userDossier(inspectingId) : ['none'],
    queryFn: () => (inspectingId ? api.getAdminUserDossier(inspectingId) : null),
    enabled: Boolean(inspectingId),
  });

  const adjustBalanceMutation = useMutation({
    mutationFn: ({ telegramId, payload }: { telegramId: number; payload: AdjustBalancePayload }) =>
      api.adjustUserBalance(telegramId, payload),
    onSuccess: (_data, variables) => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.userDossier(variables.telegramId),
      });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const handleSearch = useCallback(
    (query?: string) => {
      const q = query !== undefined ? query : searchQuery;
      setActiveSearch(q.trim());
      setPage(1);
    },
    [searchQuery]
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setActiveSearch('');
    setPage(1);
  }, []);

  const inspectUser = useCallback(
    (telegramId: number) => {
      triggerHaptic('light');
      setInspectingId(telegramId);
    },
    [triggerHaptic]
  );

  const closeDossier = useCallback(() => {
    setInspectingId(null);
  }, []);

  return {
    users: usersQuery.data?.users ?? [],
    page: usersQuery.data?.page ?? page,
    totalPages: usersQuery.data?.totalPages ?? 1,
    totalCount: usersQuery.data?.total ?? 0,
    isLoading: usersQuery.isLoading,
    isRefetching: usersQuery.isRefetching,
    refetch: usersQuery.refetch,
    setPage,
    searchQuery,
    setSearchQuery,
    handleSearch,
    handleClearSearch,
    inspectingId,
    inspectUser,
    closeDossier,
    dossier: dossierQuery.data as UserDossierResponse | null,
    isInspecting: dossierQuery.isLoading || dossierQuery.isFetching,
    adjustBalanceMutation,
    isAdjustingBalance: adjustBalanceMutation.isPending,
  };
}
