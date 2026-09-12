import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type { PanelSummary, FleetSummary } from '@/shared/types/admin.js';
import type {
  CreatePanelPayload,
  UpdatePanelPayload,
  AddPanelServicePayload,
} from '@/shared/types/api.js';

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

      queryClient.setQueryData<{ panels: PanelSummary[]; fleetSummary?: FleetSummary }>(
        queryKeys.panels,
        (old) => {
          if (!old) return old;
          return {
            ...old,
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
        }
      );
    },
    onError: () => {
      triggerHaptic('error');
    },
    onSettled: () => {
      setTestingPanelId(null);
    },
  });

  const testAllMutation = useMutation({
    mutationFn: async () => {
      triggerHaptic('medium');
      return api.testAllAdminPanels();
    },
    onSuccess: (data) => {
      triggerHaptic('success');
      if (data.results) {
        queryClient.setQueryData<{ panels: PanelSummary[]; fleetSummary?: FleetSummary }>(
          queryKeys.panels,
          (old) => {
            if (!old) return old;
            return {
              ...old,
              panels: old.panels.map((p) => {
                const res = data.results[p.id];
                if (!res) return p;
                return {
                  ...p,
                  healthy: res.healthy,
                  latencyMs: res.latencyMs ?? p.latencyMs,
                };
              }),
            };
          }
        );
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const createPanelMutation = useMutation({
    mutationFn: (payload: CreatePanelPayload) => {
      triggerHaptic('medium');
      return api.createAdminPanel(payload);
    },
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const updatePanelMutation = useMutation({
    mutationFn: ({ panelId, payload }: { panelId: string; payload: UpdatePanelPayload }) => {
      triggerHaptic('light');
      return api.updateAdminPanel(panelId, payload);
    },
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const togglePanelMutation = useMutation({
    mutationFn: ({ panelId, enabled }: { panelId: string; enabled: boolean }) => {
      triggerHaptic('selection');
      return api.toggleAdminPanel(panelId, enabled);
    },
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const setDefaultPanelMutation = useMutation({
    mutationFn: (panelId: string) => {
      triggerHaptic('selection');
      return api.setDefaultAdminPanel(panelId);
    },
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const deletePanelMutation = useMutation({
    mutationFn: (panelId: string) => {
      triggerHaptic('heavy');
      return api.deleteAdminPanel(panelId);
    },
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const addServiceMutation = useMutation({
    mutationFn: ({ panelId, payload }: { panelId: string; payload: AddPanelServicePayload }) => {
      triggerHaptic('medium');
      return api.addAdminPanelService(panelId, payload);
    },
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const setDefaultServiceMutation = useMutation({
    mutationFn: ({ panelId, serviceId }: { panelId: string; serviceId: number }) => {
      triggerHaptic('selection');
      return api.setDefaultAdminPanelService(panelId, serviceId);
    },
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const setCustomTargetMutation = useMutation({
    mutationFn: ({ panelId, serviceId }: { panelId: string; serviceId: number }) => {
      triggerHaptic('selection');
      return api.setCustomTargetAdminPanelService(panelId, serviceId);
    },
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  const deleteServiceMutation = useMutation({
    mutationFn: ({ panelId, serviceId }: { panelId: string; serviceId: number }) => {
      triggerHaptic('heavy');
      return api.deleteAdminPanelService(panelId, serviceId);
    },
    onSuccess: () => {
      triggerHaptic('success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
    },
    onError: () => {
      triggerHaptic('error');
    },
  });

  return {
    panels: query.data?.panels ?? [],
    fleetSummary: query.data?.fleetSummary,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    testingPanelId,
    isTestingAll: testAllMutation.isPending,
    isCreating: createPanelMutation.isPending,
    isUpdating: updatePanelMutation.isPending,
    isToggling: togglePanelMutation.isPending,
    isSettingDefault: setDefaultPanelMutation.isPending,
    isDeleting: deletePanelMutation.isPending,
    isAddingService: addServiceMutation.isPending,
    testPanel: (panelId: string) => testMutation.mutateAsync(panelId),
    testAllPanels: () => testAllMutation.mutateAsync(),
    createPanel: (payload: CreatePanelPayload) => createPanelMutation.mutateAsync(payload),
    updatePanel: (panelId: string, payload: UpdatePanelPayload) =>
      updatePanelMutation.mutateAsync({ panelId, payload }),
    togglePanel: (panelId: string, enabled: boolean) =>
      togglePanelMutation.mutateAsync({ panelId, enabled }),
    setDefaultPanel: (panelId: string) => setDefaultPanelMutation.mutateAsync(panelId),
    deletePanel: (panelId: string) => deletePanelMutation.mutateAsync(panelId),
    addService: (panelId: string, payload: AddPanelServicePayload) =>
      addServiceMutation.mutateAsync({ panelId, payload }),
    setDefaultService: (panelId: string, serviceId: number) =>
      setDefaultServiceMutation.mutateAsync({ panelId, serviceId }),
    setCustomTarget: (panelId: string, serviceId: number) =>
      setCustomTargetMutation.mutateAsync({ panelId, serviceId }),
    deleteService: (panelId: string, serviceId: number) =>
      deleteServiceMutation.mutateAsync({ panelId, serviceId }),
  };
}
