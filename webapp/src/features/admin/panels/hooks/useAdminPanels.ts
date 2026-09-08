import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type { PanelSummary } from '@/shared/types/admin.js';

export function useAdminPanels() {
  const queryClient = useQueryClient();
  const { triggerHaptic } = useHaptic();
  const [testingPanelId, setTestingPanelId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.panels,
    queryFn: () => api.getAdminPanels(),
  });

  const testMutation = useMutation({
    mutationFn: (panelId: string) => {
      setTestingPanelId(panelId);
      triggerHaptic('light');
      return api.testAdminPanel(panelId);
    },
    onSuccess: (data, panelId) => {
      if (data.success && data.healthy) {
        triggerHaptic('success');
      } else {
        triggerHaptic('error');
      }

      // Optimistically update panels cache
      queryClient.setQueryData<{ panels: PanelSummary[] }>(queryKeys.panels, (old) => {
        if (!old) return old;
        return {
          panels: old.panels.map((p) =>
            p.id === panelId
              ? {
                  ...p,
                  healthy: data.healthy,
                  latencyMs: data.latencyMs ?? p.latencyMs,
                }
              : p
          ),
        };
      });
    },
    onError: () => {
      triggerHaptic('error');
    },
    onSettled: () => {
      setTestingPanelId(null);
    },
  });

  return {
    panels: query.data?.panels ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    testPanel: (panelId: string) => testMutation.mutateAsync(panelId),
    testingPanelId,
  };
}
