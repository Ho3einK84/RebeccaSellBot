import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';

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

export function useUserTransactions(page = 1, limit = 10) {
  return useQuery({
    queryKey: queryKeys.user.transactions(page),
    queryFn: () => api.getUserTransactions(page, limit),
    staleTime: 30_000,
  });
}
