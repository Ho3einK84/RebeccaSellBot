import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';

export function useAdminReceipts(limit = 30) {
  const queryClient = useQueryClient();
  const { triggerHaptic } = useHaptic();

  const query = useQuery({
    queryKey: queryKeys.receipts(limit),
    queryFn: () => api.getAdminReceipts(limit),
  });

  const actionMutation = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'approve' | 'reject';
      reason?: string;
    }) => api.performReceiptAction(id, { action, reason }),
    onSuccess: (_, variables) => {
      triggerHaptic(variables.action === 'approve' ? 'success' : 'warning');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'receipts'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  return {
    receipts: query.data?.items ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    actionMutation,
    isProcessingAction: actionMutation.isPending,
  };
}
