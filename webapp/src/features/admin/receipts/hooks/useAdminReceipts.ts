import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export interface UseAdminReceiptsOptions {
  page?: number;
  limit?: number;
  status?: 'pending' | 'approved' | 'rejected' | 'voided' | 'all';
  search?: string;
}

export function useAdminReceipts(options: number | UseAdminReceiptsOptions = 20) {
  const queryClient = useQueryClient();
  const { triggerHaptic } = useHaptic();

  const normalizedOptions =
    typeof options === 'number'
      ? { page: 1, limit: options, status: 'pending' as const, search: undefined }
      : {
          page: options.page ?? 1,
          limit: options.limit ?? 20,
          status: options.status ?? 'pending',
          search: options.search,
        };

  const query = useQuery({
    queryKey: queryKeys.receipts(normalizedOptions),
    queryFn: () => api.getAdminReceipts(normalizedOptions),
  });

  const actionMutation = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
      disablePurchasedConfigs,
    }: {
      id: string;
      action: 'approve' | 'reject' | 'void';
      reason?: string;
      disablePurchasedConfigs?: boolean;
    }) => api.performReceiptAction(id, { action, reason, disablePurchasedConfigs }),
    onSuccess: (_, variables) => {
      triggerHaptic(variables.action === 'approve' ? 'success' : 'warning');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'receipts'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'userDossier'] });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const batchActionMutation = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: 'approve' }) =>
      api.performBatchReceiptAction({ ids, action }),
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'receipts'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  return {
    receipts: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    page: query.data?.page ?? normalizedOptions.page,
    totalPages: query.data?.totalPages ?? 1,
    pendingCount: query.data?.pendingCount ?? query.data?.items?.length ?? 0,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    actionMutation,
    batchActionMutation,
    isProcessingAction: actionMutation.isPending || batchActionMutation.isPending,
  };
}

export function useReceiptSettings(enabled = true) {
  const queryClient = useQueryClient();
  const { triggerHaptic } = useHaptic();

  const query = useQuery({
    queryKey: queryKeys.receiptSettings,
    queryFn: () => api.getReceiptSettings(),
    enabled,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: {
      enabled?: boolean;
      mode?: 'full' | 'simple';
      duplicatePolicy?: 'warn' | 'block';
      admins?: number[];
    }) => api.updateReceiptSettings(payload),
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.receiptSettings });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  return {
    settings: query.data,
    isLoading: query.isLoading,
    refetch: query.refetch,
    updateSettings: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}
