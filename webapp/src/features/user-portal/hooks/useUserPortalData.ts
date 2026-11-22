import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import type { TransactionFilterType } from '@/shared/types/userPortal.js';

export function useUserProfile() {
  return useQuery({
    queryKey: queryKeys.user.profile,
    queryFn: () => api.getUserProfile(),
    staleTime: 30_000,
  });
}

export function useUserConfigs() {
  return useQuery({
    queryKey: queryKeys.user.configs,
    queryFn: () => api.getUserConfigs(),
    staleTime: 30_000,
  });
}

export function useUserPackages() {
  return useQuery({
    queryKey: queryKeys.user.packages,
    queryFn: () => api.getUserPackages(),
    staleTime: 60_000,
  });
}

export function useUserTransactions(page = 1, limit = 10, filter: TransactionFilterType = 'all') {
  return useQuery({
    queryKey: queryKeys.user.transactions(page, filter),
    queryFn: () => api.getUserTransactions(page, limit, filter),
    staleTime: 30_000,
  });
}

export function useUserReceipts(page = 1, limit = 10, enabled = true) {
  return useQuery({
    queryKey: queryKeys.user.receipts(page),
    queryFn: () => api.getUserReceipts(page, limit),
    staleTime: 30_000,
    enabled,
  });
}

export function useUserWheelStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.user.wheel,
    queryFn: () => api.getUserWheelStatus(),
    staleTime: 15_000,
    enabled,
  });
}

export function useUserConfigUsage(configId: string | null, enabled = false) {
  return useQuery({
    queryKey: queryKeys.user.configUsage(configId ?? ''),
    queryFn: () => api.getUserConfigUsage(configId!),
    staleTime: 30_000,
    enabled: Boolean(configId) && enabled,
  });
}
