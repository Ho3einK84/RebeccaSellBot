import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import type { NestedTranslationKey } from '@/shared/i18n/types.js';
import { useHaptic } from '@/shared/hooks/useHaptic.js';
import type {
  AdminCategoriesResponse,
  AdminCustomPricingResponse,
  AdminPackagePoliciesDto,
  AdminPackagesResponse,
  AdminPricingQuoteResponse,
  CreateAdminCategoryPayload,
  CreateAdminPackagePayload,
  CreatePriceOverridePayload,
  CreateVolumeTierPayload,
  UpdateAdminCategoryPayload,
  UpdateAdminPackagePayload,
  UpdateCustomPricingSettingsPayload,
  UpdatePriceOverridePayload,
  UpdateVolumeTierPayload,
} from '@/shared/types/admin.js';

const SERVER_ERROR_KEY_MAP = {
  PACKAGE_LIMIT_REACHED: 'admin.packages.errors.PACKAGE_LIMIT_REACHED',
  DUPLICATE_PACKAGE_NAME: 'admin.packages.errors.DUPLICATE_PACKAGE_NAME',
  DUPLICATE_PACKAGE_ID: 'admin.packages.errors.DUPLICATE_PACKAGE_ID',
  LAST_PACKAGE_CANNOT_BE_DELETED: 'admin.packages.errors.LAST_PACKAGE_CANNOT_BE_DELETED',
  PANEL_DISABLED: 'admin.packages.errors.PANEL_DISABLED',
  PANEL_NOT_FOUND: 'admin.packages.errors.PANEL_NOT_FOUND',
  SERVICE_NOT_FOUND: 'admin.packages.errors.SERVICE_NOT_FOUND',
  DUPLICATE_CATEGORY_ID: 'admin.packages.errors.DUPLICATE_CATEGORY_ID',
  CUSTOM_PRICE_OVERFLOW: 'admin.packages.errors.CUSTOM_PRICE_OVERFLOW',
  TIER_RATE_DISCOUNT_XOR: 'admin.packages.errors.TIER_RATE_DISCOUNT_XOR',
  INVALID_REORDER_IDS: 'admin.packages.errors.INVALID_REORDER_IDS',
} as const satisfies Record<string, NestedTranslationKey>;

type MappedServerCode = keyof typeof SERVER_ERROR_KEY_MAP;

function resolvePackageApiError(
  err: unknown,
  fallbackKey: NestedTranslationKey,
  t: (key: NestedTranslationKey) => string
): string {
  if (err instanceof ApiClientError) {
    if (err.code && err.code in SERVER_ERROR_KEY_MAP) {
      return t(SERVER_ERROR_KEY_MAP[err.code as MappedServerCode]);
    }
    if (err.message) {
      return err.message;
    }
  }
  return t(fallbackKey);
}

export function useAdminPackages(onNotify: (message: string, type?: 'success' | 'error') => void) {
  const { t } = useLanguage();
  const { triggerHaptic } = useHaptic();
  const queryClient = useQueryClient();

  const packagesQuery = useQuery({
    queryKey: queryKeys.packages(),
    queryFn: () => api.getAdminPackages(),
  });

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories(true),
    queryFn: () => api.getAdminCategories(true),
  });

  const customPricingQuery = useQuery({
    queryKey: queryKeys.customPricing,
    queryFn: () => api.getAdminCustomPricing(),
  });

  const invalidatePackageSurface = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'packages'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.categories(true) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.customPricing });
    void queryClient.invalidateQueries({ queryKey: queryKeys.panels });
    void queryClient.invalidateQueries({ queryKey: queryKeys.user.packages });
    void queryClient.invalidateQueries({ queryKey: queryKeys.user.profile });
  };

  const notifyError = (err: unknown, fallbackKey: NestedTranslationKey) => {
    triggerHaptic('error');
    onNotify(resolvePackageApiError(err, fallbackKey, t), 'error');
  };

  const createPackageMutation = useMutation({
    mutationFn: (payload: CreateAdminPackagePayload) => api.createAdminPackage(payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminPackagesResponse>(queryKeys.packages(), (prev) =>
        prev
          ? {
              ...prev,
              packages: data.packages,
              totalPackages: data.packages.length,
              isFallbackActive: false,
            }
          : prev
      );
      onNotify(t('admin.packages.toast.packageCreated'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const updatePackageMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateAdminPackagePayload }) =>
      api.updateAdminPackage(id, payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminPackagesResponse>(queryKeys.packages(), (prev) =>
        prev
          ? {
              ...prev,
              packages: data.packages,
              totalPackages: data.packages.length,
              isFallbackActive: false,
            }
          : prev
      );
      onNotify(t('admin.packages.toast.packageUpdated'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const togglePackageMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled?: boolean }) =>
      api.toggleAdminPackage(id, enabled),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminPackagesResponse>(queryKeys.packages(), (prev) =>
        prev
          ? {
              ...prev,
              packages: data.packages,
              totalPackages: data.packages.length,
              isFallbackActive: false,
            }
          : prev
      );
      onNotify(t('admin.packages.toast.packageToggled'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const clonePackageMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) => api.cloneAdminPackage(id, name),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminPackagesResponse>(queryKeys.packages(), (prev) =>
        prev
          ? {
              ...prev,
              packages: data.packages,
              totalPackages: data.packages.length,
              isFallbackActive: false,
            }
          : prev
      );
      onNotify(t('admin.packages.toast.packageCloned'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const reorderPackagesMutation = useMutation({
    mutationFn: (orderedIds: string[]) => api.reorderAdminPackages(orderedIds),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminPackagesResponse>(queryKeys.packages(), (prev) =>
        prev
          ? {
              ...prev,
              packages: data.packages,
              totalPackages: data.packages.length,
              isFallbackActive: false,
            }
          : prev
      );
      onNotify(t('admin.packages.toast.packageReordered'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const deletePackageMutation = useMutation({
    mutationFn: (id: string) => api.deleteAdminPackage(id),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminPackagesResponse>(queryKeys.packages(), (prev) =>
        prev
          ? {
              ...prev,
              packages: data.packages,
              totalPackages: data.packages.length,
            }
          : prev
      );
      onNotify(t('admin.packages.toast.packageDeleted'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const updatePoliciesMutation = useMutation({
    mutationFn: (payload: Partial<AdminPackagePoliciesDto>) =>
      api.updateAdminPackagePolicies(payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminPackagesResponse>(queryKeys.packages(), (prev) =>
        prev ? { ...prev, policies: data.policies } : prev
      );
      onNotify(t('admin.packages.toast.policiesSaved'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const createCategoryMutation = useMutation({
    mutationFn: (payload: CreateAdminCategoryPayload) => api.createAdminCategory(payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCategoriesResponse>(queryKeys.categories(true), (prev) =>
        prev ? { ...prev, categories: data.categories } : prev
      );
      onNotify(t('admin.packages.toast.categoryCreated'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateAdminCategoryPayload }) =>
      api.updateAdminCategory(id, payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCategoriesResponse>(queryKeys.categories(true), (prev) =>
        prev ? { ...prev, categories: data.categories } : prev
      );
      onNotify(t('admin.packages.toast.categoryUpdated'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const toggleCategoryMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled?: boolean }) =>
      api.toggleAdminCategory(id, enabled),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCategoriesResponse>(queryKeys.categories(true), (prev) =>
        prev ? { ...prev, categories: data.categories } : prev
      );
      onNotify(t('admin.packages.toast.categoryUpdated'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const reorderCategoriesMutation = useMutation({
    mutationFn: (orderedIds: string[]) => api.reorderAdminCategories(orderedIds),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCategoriesResponse>(queryKeys.categories(true), (prev) =>
        prev ? { ...prev, categories: data.categories } : prev
      );
      onNotify(t('admin.packages.toast.categoryUpdated'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) => api.deleteAdminCategory(id),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCategoriesResponse>(queryKeys.categories(true), (prev) =>
        prev ? { ...prev, categories: data.categories } : prev
      );
      onNotify(t('admin.packages.toast.categoryDeleted'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const updateCustomSettingsMutation = useMutation({
    mutationFn: (payload: UpdateCustomPricingSettingsPayload) =>
      api.updateAdminCustomPricingSettings(payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCustomPricingResponse>(queryKeys.customPricing, (prev) =>
        prev ? { ...prev, settings: data.settings } : prev
      );
      onNotify(t('admin.packages.toast.customSettingsSaved'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const createTierMutation = useMutation({
    mutationFn: (payload: CreateVolumeTierPayload) => api.createAdminVolumeTier(payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCustomPricingResponse>(queryKeys.customPricing, (prev) =>
        prev ? { ...prev, tiers: data.tiers } : prev
      );
      onNotify(t('admin.packages.toast.tierSaved'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const updateTierMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateVolumeTierPayload }) =>
      api.updateAdminVolumeTier(id, payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCustomPricingResponse>(queryKeys.customPricing, (prev) =>
        prev ? { ...prev, tiers: data.tiers } : prev
      );
      onNotify(t('admin.packages.toast.tierSaved'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const deleteTierMutation = useMutation({
    mutationFn: (id: string) => api.deleteAdminVolumeTier(id),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCustomPricingResponse>(queryKeys.customPricing, (prev) =>
        prev ? { ...prev, tiers: data.tiers } : prev
      );
      onNotify(t('admin.packages.toast.tierDeleted'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const createOverrideMutation = useMutation({
    mutationFn: (payload: CreatePriceOverridePayload) => api.createAdminPriceOverride(payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCustomPricingResponse>(queryKeys.customPricing, (prev) =>
        prev ? { ...prev, overrides: data.overrides } : prev
      );
      onNotify(t('admin.packages.toast.overrideSaved'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const updateOverrideMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdatePriceOverridePayload }) =>
      api.updateAdminPriceOverride(id, payload),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCustomPricingResponse>(queryKeys.customPricing, (prev) =>
        prev ? { ...prev, overrides: data.overrides } : prev
      );
      onNotify(t('admin.packages.toast.overrideSaved'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const reorderOverridesMutation = useMutation({
    mutationFn: (orderedIds: string[]) => api.reorderAdminPriceOverrides(orderedIds),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCustomPricingResponse>(queryKeys.customPricing, (prev) =>
        prev ? { ...prev, overrides: data.overrides } : prev
      );
      onNotify(t('admin.packages.toast.overrideReordered'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const deleteOverrideMutation = useMutation({
    mutationFn: (id: string) => api.deleteAdminPriceOverride(id),
    onSuccess: (data) => {
      queryClient.setQueryData<AdminCustomPricingResponse>(queryKeys.customPricing, (prev) =>
        prev ? { ...prev, overrides: data.overrides } : prev
      );
      onNotify(t('admin.packages.toast.overrideDeleted'), 'success');
      invalidatePackageSurface();
    },
    onError: (err) => notifyError(err, 'admin.packages.toast.actionFailed'),
  });

  const simulateQuoteMutation = useMutation<
    AdminPricingQuoteResponse,
    unknown,
    { gbAmount: number; durationDays: number }
  >({
    mutationFn: ({ gbAmount, durationDays }) =>
      api.simulateAdminCustomQuote(gbAmount, durationDays),
    onError: (err) => notifyError(err, 'admin.packages.toast.quoteFailed'),
  });

  const refetchAll = async () => {
    await Promise.all([
      packagesQuery.refetch(),
      categoriesQuery.refetch(),
      customPricingQuery.refetch(),
    ]);
  };

  return {
    packagesData: packagesQuery.data,
    categoriesData: categoriesQuery.data,
    customPricingData: customPricingQuery.data,
    isLoading: packagesQuery.isLoading,
    isError: packagesQuery.isError,
    isCategoriesLoading: categoriesQuery.isLoading,
    isCategoriesError: categoriesQuery.isError,
    refetchCategories: categoriesQuery.refetch,
    isCustomPricingLoading: customPricingQuery.isLoading,
    isCustomPricingError: customPricingQuery.isError,
    refetchCustomPricing: customPricingQuery.refetch,
    isFetching:
      packagesQuery.isFetching || categoriesQuery.isFetching || customPricingQuery.isFetching,
    refetchAll,

    createPackage: createPackageMutation.mutateAsync,
    isCreatingPackage: createPackageMutation.isPending,

    updatePackage: (id: string, payload: UpdateAdminPackagePayload) =>
      updatePackageMutation.mutateAsync({ id, payload }),
    isUpdatingPackage: updatePackageMutation.isPending,

    togglePackage: (id: string, enabled?: boolean) =>
      togglePackageMutation.mutateAsync({ id, enabled }),
    isTogglingPackage: togglePackageMutation.isPending,
    togglingPackageId: togglePackageMutation.variables?.id ?? null,

    clonePackage: (id: string, name?: string) => clonePackageMutation.mutateAsync({ id, name }),
    isCloningPackage: clonePackageMutation.isPending,

    reorderPackages: reorderPackagesMutation.mutateAsync,
    isReorderingPackages: reorderPackagesMutation.isPending,

    deletePackage: deletePackageMutation.mutateAsync,
    isDeletingPackage: deletePackageMutation.isPending,

    updatePolicies: updatePoliciesMutation.mutateAsync,
    isUpdatingPolicies: updatePoliciesMutation.isPending,

    createCategory: createCategoryMutation.mutateAsync,
    isCreatingCategory: createCategoryMutation.isPending,

    updateCategory: (id: string, payload: UpdateAdminCategoryPayload) =>
      updateCategoryMutation.mutateAsync({ id, payload }),
    isUpdatingCategory: updateCategoryMutation.isPending,

    toggleCategory: (id: string, enabled?: boolean) =>
      toggleCategoryMutation.mutateAsync({ id, enabled }),
    isTogglingCategory: toggleCategoryMutation.isPending,

    reorderCategories: reorderCategoriesMutation.mutateAsync,
    isReorderingCategories: reorderCategoriesMutation.isPending,

    deleteCategory: deleteCategoryMutation.mutateAsync,
    isDeletingCategory: deleteCategoryMutation.isPending,

    updateCustomSettings: updateCustomSettingsMutation.mutateAsync,
    isUpdatingCustomSettings: updateCustomSettingsMutation.isPending,

    createTier: createTierMutation.mutateAsync,
    isCreatingTier: createTierMutation.isPending,

    updateTier: (id: string, payload: UpdateVolumeTierPayload) =>
      updateTierMutation.mutateAsync({ id, payload }),
    isUpdatingTier: updateTierMutation.isPending,

    deleteTier: deleteTierMutation.mutateAsync,
    isDeletingTier: deleteTierMutation.isPending,

    createOverride: createOverrideMutation.mutateAsync,
    isCreatingOverride: createOverrideMutation.isPending,

    updateOverride: (id: string, payload: UpdatePriceOverridePayload) =>
      updateOverrideMutation.mutateAsync({ id, payload }),
    isUpdatingOverride: updateOverrideMutation.isPending,

    reorderOverrides: reorderOverridesMutation.mutateAsync,
    isReorderingOverrides: reorderOverridesMutation.isPending,

    deleteOverride: deleteOverrideMutation.mutateAsync,
    isDeletingOverride: deleteOverrideMutation.isPending,

    simulateQuote: ({ gbAmount, durationDays }: { gbAmount: number; durationDays: number }) =>
      simulateQuoteMutation.mutateAsync({ gbAmount, durationDays }),
    quoteResult: simulateQuoteMutation.data,
    isSimulatingQuote: simulateQuoteMutation.isPending,
  };
}
