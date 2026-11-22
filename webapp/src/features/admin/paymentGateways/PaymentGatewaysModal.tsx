import React, { useEffect, useState } from 'react';
import {
  Zap,
  Coins,
  Inbox,
  Copy,
  Check,
  KeyRound,
  Save,
  RefreshCw,
  CheckCircle2,
  Trash2,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import { useCopy } from '@/shared/hooks/useCopy.js';
import { api } from '@/shared/lib/api.js';
import { queryKeys } from '@/shared/lib/queryKeys.js';
import { normalizeInputDigits } from '@/shared/lib/formatters.js';
import { Modal } from '@/shared/components/ui/Modal.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Switch } from '@/shared/components/ui/Switch.js';
import { SegmentedControl } from '@/shared/components/ui/SegmentedControl.js';
import { AlertBanner } from '@/shared/components/ui/AlertBanner.js';
import { Pagination } from '@/shared/components/ui/Pagination.js';

interface PaymentGatewaysModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

type GatewayTab = 'forapp' | 'nowpayments' | 'deposits';
type DepositFilter = 'unmatched' | 'matched' | 'all';

function parseIntField(raw: string): number | undefined {
  const cleaned = normalizeInputDigits(raw).replace(/[^\d]/g, '').trim();
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  return Number.isSafeInteger(num) ? num : undefined;
}

export const PaymentGatewaysModal: React.FC<PaymentGatewaysModalProps> = ({
  isOpen,
  onClose,
  onNotify,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber, formatIsoDate } = useFormatters();
  const { copy, isCopied } = useCopy();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<GatewayTab>('forapp');
  const [depositFilter, setDepositFilter] = useState<DepositFilter>('unmatched');
  const [depositsPage, setDepositsPage] = useState(1);

  // ForApp local form state
  const [faEnabled, setFaEnabled] = useState(false);
  const [faExpiry, setFaExpiry] = useState('20');
  const [revealedForAppKey, setRevealedForAppKey] = useState<string | null>(null);

  // NOWPayments local form state
  const [npEnabled, setNpEnabled] = useState(false);
  const [npSandbox, setNpSandbox] = useState(false);
  const [npApiKey, setNpApiKey] = useState('');
  const [npIpnSecret, setNpIpnSecret] = useState('');
  const [npRateMode, setNpRateMode] = useState<'manual' | 'auto'>('manual');
  const [npManualRate, setNpManualRate] = useState('80000');
  const [npMinAmount, setNpMinAmount] = useState('100000');
  const [npMaxAmount, setNpMaxAmount] = useState('50000000');
  const [npCashback, setNpCashback] = useState('0');
  const [npExpiry, setNpExpiry] = useState('60');

  // Inline match inputs keyed by deposit id
  const [matchTargets, setMatchTargets] = useState<Record<string, string>>({});

  const { data: gwData, isLoading: isLoadingGateways } = useQuery({
    queryKey: queryKeys.paymentGateways,
    queryFn: () => api.getAdminPaymentGateways(),
    enabled: isOpen,
  });

  const { data: depositsData, isLoading: isLoadingDeposits } = useQuery({
    queryKey: queryKeys.forappDeposits({ page: depositsPage, status: depositFilter }),
    queryFn: () =>
      api.getAdminForAppDeposits({ page: depositsPage, limit: 10, status: depositFilter }),
    enabled: isOpen && tab === 'deposits',
  });

  useEffect(() => {
    if (!gwData) return;
    setFaEnabled(gwData.forapp.enabled);
    setFaExpiry(String(gwData.forapp.orderExpiryMinutes));

    setNpEnabled(gwData.nowpayments.enabled);
    setNpSandbox(gwData.nowpayments.sandbox);
    setNpRateMode(gwData.nowpayments.rateMode);
    setNpManualRate(String(gwData.nowpayments.manualUsdRateToman));
    setNpMinAmount(String(gwData.nowpayments.minAmountToman));
    setNpMaxAmount(String(gwData.nowpayments.maxAmountToman));
    setNpCashback(String(gwData.nowpayments.cashbackPercent));
    setNpExpiry(String(gwData.nowpayments.orderExpiryMinutes));
  }, [gwData]);

  const saveForAppMutation = useMutation({
    mutationFn: () =>
      api.updateAdminForAppConfig({
        enabled: faEnabled,
        orderExpiryMinutes: parseIntField(faExpiry),
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.paymentGateways, (prev: typeof gwData) =>
        prev ? { ...prev, forapp: res.forapp } : prev
      );
      onNotify(t('admin.paymentGateways.savedNotify'), 'success');
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const rotateKeyMutation = useMutation({
    mutationFn: () => api.rotateAdminForAppKey(),
    onSuccess: (res) => {
      setRevealedForAppKey(res.apiKey);
      queryClient.setQueryData(queryKeys.paymentGateways, (prev: typeof gwData) =>
        prev ? { ...prev, forapp: res.forapp } : prev
      );
      onNotify(t('admin.paymentGateways.keyRotatedNotify'), 'success');
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const saveNowPaymentsMutation = useMutation({
    mutationFn: () =>
      api.updateAdminNowPaymentsConfig({
        enabled: npEnabled,
        sandbox: npSandbox,
        ...(npApiKey.trim() ? { apiKey: npApiKey.trim() } : {}),
        ...(npIpnSecret.trim() ? { ipnSecret: npIpnSecret.trim() } : {}),
        rateMode: npRateMode,
        manualUsdRateToman: parseIntField(npManualRate),
        minAmountToman: parseIntField(npMinAmount),
        maxAmountToman: parseIntField(npMaxAmount),
        cashbackPercent: parseIntField(npCashback),
        orderExpiryMinutes: parseIntField(npExpiry),
      }),
    onSuccess: (res) => {
      setNpApiKey('');
      setNpIpnSecret('');
      queryClient.setQueryData(queryKeys.paymentGateways, (prev: typeof gwData) =>
        prev ? { ...prev, nowpayments: res.nowpayments } : prev
      );
      onNotify(t('admin.paymentGateways.savedNotify'), 'success');
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const testNowPaymentsMutation = useMutation({
    mutationFn: () => api.testAdminNowPayments(),
    onSuccess: (res) => {
      if (res.ok) {
        onNotify(
          t('admin.paymentGateways.npTestOk').replace('{rate}', formatNumber(res.rateToman)),
          'success'
        );
      } else {
        onNotify(t('admin.paymentGateways.npTestFailed').replace('{reason}', res.message), 'error');
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.paymentGateways });
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const matchDepositMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: string }) =>
      api.matchAdminForAppDeposit(id, { target }),
    onSuccess: (_res, vars) => {
      setMatchTargets((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'forappDeposits'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.paymentGateways });
      onNotify(t('admin.paymentGateways.depositMatchedNotify'), 'success');
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const dismissDepositMutation = useMutation({
    mutationFn: (id: string) => api.dismissAdminForAppDeposit(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'forappDeposits'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.paymentGateways });
      onNotify(t('admin.paymentGateways.depositDismissedNotify'), 'success');
    },
    onError: (err: Error) => onNotify(err.message || t('common.error'), 'error'),
  });

  const unmatchedCount = gwData?.forapp.unmatchedCount ?? depositsData?.unmatchedCount ?? 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.paymentGateways.title')}
      subtitle={t('admin.paymentGateways.subtitle')}
      icon={<Zap className="w-5 h-5 text-brand-fg" />}
      maxWidth="2xl"
    >
      <div className="space-y-4">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          ariaLabel={t('admin.paymentGateways.title')}
          options={[
            {
              id: 'forapp',
              label: t('admin.paymentGateways.tabForApp'),
              icon: Zap,
              tone: 'warn',
            },
            {
              id: 'nowpayments',
              label: t('admin.paymentGateways.tabNowPayments'),
              icon: Coins,
              tone: 'brand',
            },
            {
              id: 'deposits',
              label: t('admin.paymentGateways.tabDeposits'),
              icon: Inbox,
              count: unmatchedCount > 0 ? formatNumber(unmatchedCount) : null,
              tone: 'danger',
            },
          ]}
        />

        {isLoadingGateways && !gwData ? (
          <div className="py-10 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-brand-fg" />
          </div>
        ) : null}

        {/* TAB 1: ForApp */}
        {tab === 'forapp' && gwData && (
          <div className="space-y-4">
            <Card padding="md" className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">
                  {t('admin.paymentGateways.forappEnabledLabel')}
                </div>
                <p className="text-xs text-ink-muted m-0 mt-0.5 leading-relaxed">
                  {t('admin.paymentGateways.forappEnabledDesc')}
                </p>
              </div>
              <Switch
                checked={faEnabled}
                onChange={setFaEnabled}
                ariaLabel={t('admin.paymentGateways.forappEnabledLabel')}
              />
            </Card>

            {/* Webhook URL */}
            <Card padding="md" className="space-y-2">
              <div className="text-xs font-semibold text-ink-soft">
                {t('admin.paymentGateways.webhookUrlLabel')}
              </div>
              {gwData.forapp.webhookUrl ? (
                <div className="flex items-center gap-2">
                  <code
                    dir="ltr"
                    className="flex-1 text-xs font-mono bg-surface-2 border border-line rounded-ctl px-3 py-2 text-ink break-all select-all"
                  >
                    {gwData.forapp.webhookUrl}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant={isCopied('fa-webhook') ? 'success' : 'secondary'}
                    onClick={async () => {
                      if (await copy(gwData.forapp.webhookUrl!, 'fa-webhook')) {
                        onNotify(t('common.copied'), 'success');
                      }
                    }}
                  >
                    {isCopied('fa-webhook') ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              ) : (
                <AlertBanner tone="warn">{t('admin.paymentGateways.webhookMissing')}</AlertBanner>
              )}
            </Card>

            {/* X-API-Key */}
            <Card padding="md" className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-brand-fg" />
                  <span className="text-xs font-semibold text-ink">
                    {t('admin.paymentGateways.apiKeyLabel')}
                  </span>
                </div>
                <Badge variant={gwData.forapp.apiKeyConfigured ? 'success' : 'neutral'} size="xs">
                  {gwData.forapp.apiKeyConfigured
                    ? `${t('admin.paymentGateways.configured')} (${gwData.forapp.apiKeyMasked ?? '••••'})`
                    : t('admin.paymentGateways.notConfigured')}
                </Badge>
              </div>

              {revealedForAppKey && (
                <div className="rounded-tile border border-ok/35 bg-ok-soft/60 p-3 space-y-2">
                  <div className="text-xs font-semibold text-ok-fg">
                    {t('admin.paymentGateways.newKeyBannerTitle')}
                  </div>
                  <div className="flex items-center gap-2">
                    <code
                      dir="ltr"
                      className="flex-1 text-xs font-mono bg-surface border border-ok/30 rounded-ctl px-2.5 py-2 text-ink break-all select-all"
                    >
                      {revealedForAppKey}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant={isCopied('fa-key') ? 'success' : 'secondary'}
                      onClick={async () => {
                        if (await copy(revealedForAppKey, 'fa-key')) {
                          onNotify(t('common.copied'), 'success');
                        }
                      }}
                    >
                      {isCopied('fa-key') ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={rotateKeyMutation.isPending}
                onClick={() => rotateKeyMutation.mutate()}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {rotateKeyMutation.isPending
                    ? t('admin.paymentGateways.rotatingKey')
                    : t('admin.paymentGateways.rotateKeyBtn')}
                </span>
              </Button>
            </Card>

            {/* Expiry + Save */}
            <Card padding="md" className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-ink-soft">
                  {t('admin.paymentGateways.expiryMinutesLabel')}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  value={faExpiry}
                  onChange={(e) => setFaExpiry(e.target.value)}
                  className="w-full h-11 px-3 rounded-ctl border border-line bg-surface-2 text-sm font-mono text-ink rs-focus"
                />
              </label>

              <Button
                type="button"
                variant="primary"
                block
                loading={saveForAppMutation.isPending}
                onClick={() => saveForAppMutation.mutate()}
              >
                <Save className="w-4 h-4" />
                <span>
                  {saveForAppMutation.isPending
                    ? t('admin.paymentGateways.saving')
                    : t('admin.paymentGateways.saveBtn')}
                </span>
              </Button>
            </Card>
          </div>
        )}

        {/* TAB 2: NOWPayments */}
        {tab === 'nowpayments' && gwData && (
          <div className="space-y-4">
            <Card padding="md" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    {t('admin.paymentGateways.npEnabledLabel')}
                  </div>
                  <p className="text-xs text-ink-muted m-0 mt-0.5">
                    {t('admin.paymentGateways.npEnabledDesc')}
                  </p>
                </div>
                <Switch
                  checked={npEnabled}
                  onChange={setNpEnabled}
                  ariaLabel={t('admin.paymentGateways.npEnabledLabel')}
                />
              </div>

              <div className="pt-3 border-t border-line flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    {t('admin.paymentGateways.npSandboxLabel')}
                  </div>
                  <p className="text-xs text-ink-muted m-0 mt-0.5">
                    {t('admin.paymentGateways.npSandboxDesc')}
                  </p>
                </div>
                <Switch
                  checked={npSandbox}
                  onChange={setNpSandbox}
                  ariaLabel={t('admin.paymentGateways.npSandboxLabel')}
                />
              </div>
            </Card>

            {/* IPN Webhook URL */}
            <Card padding="md" className="space-y-2">
              <div className="text-xs font-semibold text-ink-soft">
                {t('admin.paymentGateways.webhookUrlLabel')}
              </div>
              {gwData.nowpayments.webhookUrl ? (
                <div className="flex items-center gap-2">
                  <code
                    dir="ltr"
                    className="flex-1 text-xs font-mono bg-surface-2 border border-line rounded-ctl px-3 py-2 text-ink break-all select-all"
                  >
                    {gwData.nowpayments.webhookUrl}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant={isCopied('np-webhook') ? 'success' : 'secondary'}
                    onClick={async () => {
                      if (await copy(gwData.nowpayments.webhookUrl!, 'np-webhook')) {
                        onNotify(t('common.copied'), 'success');
                      }
                    }}
                  >
                    {isCopied('np-webhook') ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              ) : (
                <AlertBanner tone="warn">{t('admin.paymentGateways.webhookMissing')}</AlertBanner>
              )}
            </Card>

            {/* Encrypted Credentials */}
            <Card padding="md" className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-soft">
                    {t('admin.paymentGateways.npApiKeyLabel')}
                  </span>
                  <Badge
                    variant={gwData.nowpayments.apiKeyConfigured ? 'success' : 'neutral'}
                    size="xs"
                  >
                    {gwData.nowpayments.apiKeyConfigured
                      ? t('admin.paymentGateways.configured')
                      : t('admin.paymentGateways.notConfigured')}
                  </Badge>
                </div>
                <input
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  value={npApiKey}
                  onChange={(e) => setNpApiKey(e.target.value)}
                  placeholder={t('admin.paymentGateways.npApiKeyPlaceholder')}
                  className="w-full h-11 px-3 rounded-ctl border border-line bg-surface-2 text-xs font-mono text-ink rs-focus"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-soft">
                    {t('admin.paymentGateways.npIpnSecretLabel')}
                  </span>
                  <Badge
                    variant={gwData.nowpayments.ipnSecretConfigured ? 'success' : 'neutral'}
                    size="xs"
                  >
                    {gwData.nowpayments.ipnSecretConfigured
                      ? t('admin.paymentGateways.configured')
                      : t('admin.paymentGateways.notConfigured')}
                  </Badge>
                </div>
                <input
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  value={npIpnSecret}
                  onChange={(e) => setNpIpnSecret(e.target.value)}
                  placeholder={t('admin.paymentGateways.npIpnSecretPlaceholder')}
                  className="w-full h-11 px-3 rounded-ctl border border-line bg-surface-2 text-xs font-mono text-ink rs-focus"
                />
              </div>
            </Card>

            {/* Rate, Limits, Cashback */}
            <Card padding="md" className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-ink-soft">
                  {t('admin.paymentGateways.npRateModeLabel')}
                </span>
                <Badge variant="info" size="xs">
                  {t('admin.paymentGateways.npEffectiveRateBadge')
                    .replace('{rate}', formatNumber(gwData.nowpayments.effectiveUsdRateToman))
                    .replace('{source}', gwData.nowpayments.effectiveRateSource)}
                </Badge>
              </div>

              <SegmentedControl
                value={npRateMode}
                onChange={setNpRateMode}
                ariaLabel={t('admin.paymentGateways.npRateModeLabel')}
                options={[
                  {
                    id: 'manual',
                    label: t('admin.paymentGateways.npRateModeManual'),
                    tone: 'brand',
                  },
                  {
                    id: 'auto',
                    label: t('admin.paymentGateways.npRateModeAuto'),
                    tone: 'ok',
                  },
                ]}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs text-ink-soft">
                    {t('admin.paymentGateways.npManualRateLabel')}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    value={npManualRate}
                    onChange={(e) => setNpManualRate(e.target.value)}
                    className="w-full h-10 px-3 rounded-ctl border border-line bg-surface-2 text-xs font-mono text-ink rs-focus"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-ink-soft">
                    {t('admin.paymentGateways.npCashbackLabel')}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    value={npCashback}
                    onChange={(e) => setNpCashback(e.target.value)}
                    className="w-full h-10 px-3 rounded-ctl border border-line bg-surface-2 text-xs font-mono text-ink rs-focus"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-ink-soft">
                    {t('admin.paymentGateways.npMinAmountLabel')}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    value={npMinAmount}
                    onChange={(e) => setNpMinAmount(e.target.value)}
                    className="w-full h-10 px-3 rounded-ctl border border-line bg-surface-2 text-xs font-mono text-ink rs-focus"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-ink-soft">
                    {t('admin.paymentGateways.npMaxAmountLabel')}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    value={npMaxAmount}
                    onChange={(e) => setNpMaxAmount(e.target.value)}
                    className="w-full h-10 px-3 rounded-ctl border border-line bg-surface-2 text-xs font-mono text-ink rs-focus"
                  />
                </label>

                <label className="block space-y-1 sm:col-span-2">
                  <span className="text-xs text-ink-soft">
                    {t('admin.paymentGateways.npExpiryLabel')}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    value={npExpiry}
                    onChange={(e) => setNpExpiry(e.target.value)}
                    className="w-full h-10 px-3 rounded-ctl border border-line bg-surface-2 text-xs font-mono text-ink rs-focus"
                  />
                </label>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <Button
                  type="button"
                  variant="primary"
                  className="flex-1"
                  loading={saveNowPaymentsMutation.isPending}
                  onClick={() => saveNowPaymentsMutation.mutate()}
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {saveNowPaymentsMutation.isPending
                      ? t('admin.paymentGateways.saving')
                      : t('admin.paymentGateways.saveBtn')}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  loading={testNowPaymentsMutation.isPending}
                  onClick={() => testNowPaymentsMutation.mutate()}
                >
                  <ShieldCheck className="w-4 h-4 text-ok-fg" />
                  <span>
                    {testNowPaymentsMutation.isPending
                      ? t('admin.paymentGateways.npTesting')
                      : t('admin.paymentGateways.npTestBtn')}
                  </span>
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* TAB 3: ForApp Deposits Queue */}
        {tab === 'deposits' && (
          <div className="space-y-3">
            <SegmentedControl
              value={depositFilter}
              onChange={(next) => {
                setDepositFilter(next);
                setDepositsPage(1);
              }}
              ariaLabel={t('admin.paymentGateways.tabDeposits')}
              options={[
                {
                  id: 'unmatched',
                  label: t('admin.paymentGateways.depositsFilterUnmatched'),
                  count: unmatchedCount > 0 ? formatNumber(unmatchedCount) : null,
                  tone: 'warn',
                },
                {
                  id: 'matched',
                  label: t('admin.paymentGateways.depositsFilterMatched'),
                  tone: 'ok',
                },
                {
                  id: 'all',
                  label: t('admin.paymentGateways.depositsFilterAll'),
                  tone: 'brand',
                },
              ]}
            />

            {isLoadingDeposits ? (
              <div className="py-8 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-brand-fg" />
              </div>
            ) : !depositsData || depositsData.items.length === 0 ? (
              <Card padding="lg" className="text-center text-xs text-ink-muted">
                {t('admin.paymentGateways.depositsEmpty')}
              </Card>
            ) : (
              <div className="space-y-2.5">
                {depositsData.items.map((dep) => {
                  const statusLabel =
                    dep.status === 'matched'
                      ? t('admin.paymentGateways.depositStatusMatched')
                      : dep.status === 'manual_matched'
                        ? t('admin.paymentGateways.depositStatusManual')
                        : dep.status === 'unmatched'
                          ? t('admin.paymentGateways.depositStatusUnmatched')
                          : dep.status === 'dismissed'
                            ? t('admin.paymentGateways.depositStatusDismissed')
                            : t('admin.paymentGateways.depositStatusIgnored');
                  const statusVariant =
                    dep.status === 'matched' || dep.status === 'manual_matched'
                      ? 'success'
                      : dep.status === 'unmatched'
                        ? 'warning'
                        : 'neutral';
                  const targetInput = matchTargets[dep.id] ?? '';

                  return (
                    <Card key={dep.id} padding="md" className="space-y-2.5 text-start">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <bdi dir="ltr" className="text-sm font-bold tnum text-ink">
                              {dep.amountToman !== null
                                ? formatMoney(dep.amountToman)
                                : `${formatNumber(dep.amountRial)} Rial`}
                            </bdi>
                            <Badge variant={statusVariant} size="xs">
                              {statusLabel}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-ink-muted tnum">
                            {dep.bank ? `${dep.bank} · ` : ''}
                            {formatNumber(dep.amountRial)} Rial · {formatIsoDate(dep.createdAt)}
                          </div>
                        </div>
                        {dep.matchedTelegramId && (
                          <Badge variant="info" size="xs">
                            UID: {dep.matchedTelegramId}
                          </Badge>
                        )}
                      </div>

                      {dep.rawBody && (
                        <p className="text-[11px] text-ink-soft bg-surface-2 rounded-ctl p-2 m-0 leading-relaxed break-words">
                          {dep.rawBody.slice(0, 240)}
                        </p>
                      )}

                      {dep.status === 'unmatched' && (
                        <div className="flex flex-col sm:flex-row gap-2 pt-1">
                          <input
                            type="text"
                            dir="ltr"
                            value={targetInput}
                            onChange={(e) =>
                              setMatchTargets((prev) => ({ ...prev, [dep.id]: e.target.value }))
                            }
                            placeholder={t('admin.paymentGateways.depositMatchPlaceholder')}
                            className="flex-1 h-9 px-2.5 rounded-ctl border border-line bg-surface-2 text-xs font-mono text-ink rs-focus"
                          />
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              type="button"
                              size="sm"
                              variant="primary"
                              disabled={!targetInput.trim() || matchDepositMutation.isPending}
                              loading={matchDepositMutation.isPending}
                              onClick={() =>
                                matchDepositMutation.mutate({
                                  id: dep.id,
                                  target: targetInput.trim(),
                                })
                              }
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{t('admin.paymentGateways.depositMatchBtn')}</span>
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={dismissDepositMutation.isPending}
                              onClick={() => dismissDepositMutation.mutate(dep.id)}
                              title={t('admin.paymentGateways.depositDismissBtn')}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-danger-fg" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}

                <Pagination
                  page={depositsData.page}
                  totalPages={depositsData.totalPages}
                  prevLabel={t('admin.users.paginationPrev')}
                  nextLabel={t('admin.users.paginationNext')}
                  pageLabel={t('admin.users.paginationPage')
                    .replace('{page}', formatNumber(depositsData.page))
                    .replace('{totalPages}', formatNumber(depositsData.totalPages))}
                  onPageChange={setDepositsPage}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
