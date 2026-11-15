import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Calculator, Info, RotateCcw } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card.js';
import { Badge } from '@/shared/components/ui/Badge.js';
import { Button } from '@/shared/components/ui/Button.js';
import { Input } from '@/shared/components/ui/Input.js';
import { useLanguage } from '@/shared/i18n/LanguageContext.js';
import { useFormatters } from '@/shared/hooks/useFormatters.js';
import type { AdminPricingQuoteResponse } from '@/shared/types/admin.js';
import {
  computePackageUnitPrice,
  validateQuoteSimulatorForm,
  type ValidationIssue,
} from '../packageValidation.js';

interface QuoteSimulatorCardProps {
  defaultGb: number;
  defaultDays: number;
  basePricePerGb?: number;
  basePricePerDay?: number;
  isSimulating: boolean;
  result: AdminPricingQuoteResponse | undefined;
  onSimulate: (input: {
    gbAmount: number;
    durationDays: number;
  }) => Promise<AdminPricingQuoteResponse>;
}

export const QuoteSimulatorCard: React.FC<QuoteSimulatorCardProps> = ({
  defaultGb,
  defaultDays,
  basePricePerGb = 0,
  basePricePerDay = 0,
  isSimulating,
  result,
  onSimulate,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatNumber, formatToman } = useFormatters();

  const [gbRaw, setGbRaw] = useState(String(defaultGb || 50));
  const [daysRaw, setDaysRaw] = useState(String(defaultDays || 30));
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const hasEditedGbRef = useRef(false);
  const hasEditedDaysRef = useRef(false);

  useEffect(() => {
    if (!hasEditedGbRef.current) {
      setGbRaw(String(defaultGb || 50));
    }
    if (!hasEditedDaysRef.current) {
      setDaysRaw(String(defaultDays || 30));
    }
  }, [defaultGb, defaultDays]);

  const fieldError = (field: string): string | null => {
    const issue = issues.find((item) => item.field === field);
    return issue ? t(issue.messageKey, issue.params) : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateQuoteSimulatorForm(gbRaw, daysRaw);
    if (!validation.valid || !validation.parsed) {
      setIssues(validation.errors);
      return;
    }
    setIssues([]);
    try {
      await onSimulate(validation.parsed);
    } catch {
      // error toast handled by useAdminPackages onError
    }
  };

  const renderWarningLabel = (code: string): string => {
    if (code === 'CUSTOM_VOLUME_DISABLED') return t('admin.packages.simulator.warningDisabled');
    if (code === 'GB_OUTSIDE_CONFIGURED_BOUNDS')
      return t('admin.packages.simulator.warningOutOfBounds');
    if (code === 'DURATION_EXCEEDS_WEB_LIMIT')
      return t('admin.packages.simulator.warningExceedsWebLimit');
    return code;
  };

  const sourceBadge = result?.quote.overrideId
    ? t('admin.packages.simulator.sourceOverride', { id: result.quote.overrideId })
    : result?.quote.tierId
      ? t('admin.packages.simulator.sourceTier', { id: result.quote.tierId })
      : t('admin.packages.simulator.sourceDefault');

  const baseReferencePrice =
    result && (basePricePerGb > 0 || basePricePerDay > 0)
      ? result.gbAmount * basePricePerGb + result.durationDays * basePricePerDay
      : null;
  const priceDeltaVsBase =
    result && baseReferencePrice !== null ? baseReferencePrice - result.quote.totalPrice : 0;

  return (
    <Card padding="md" className="space-y-3">
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-tile bg-brand-soft border border-brand/20 flex items-center justify-center shrink-0">
          <Calculator className="w-4 h-4 text-brand-fg" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{t('admin.packages.simulator.title')}</h3>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {t('admin.packages.simulator.subtitle')}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-start">
          <div>
            <label
              htmlFor="sim-gb-input"
              className="block text-xs font-semibold text-ink-soft mb-1"
            >
              {t('admin.packages.simulator.gbLabel')}
            </label>
            <Input
              id="sim-gb-input"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={gbRaw}
              onChange={(e) => {
                hasEditedGbRef.current = true;
                setGbRaw(e.target.value);
              }}
            />
            <div className="flex items-center gap-1 flex-wrap mt-1.5">
              {(['20', '50', '100', '250'] as const).map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => {
                    hasEditedGbRef.current = true;
                    setGbRaw(sample);
                  }}
                  className={`px-1.5 py-0.5 rounded border text-[11px] tnum transition-colors ${
                    gbRaw === sample
                      ? 'bg-brand-soft border-brand/40 text-brand-fg font-semibold'
                      : 'bg-surface-2 border-line text-ink-muted hover:text-ink'
                  }`}
                >
                  {t('admin.packages.simulator.presetSample', { gb: formatNumber(Number(sample)) })}
                </button>
              ))}
            </div>
            {fieldError('gbAmount') && (
              <p className="text-xs text-danger mt-1">{fieldError('gbAmount')}</p>
            )}
          </div>

          <div className="p-2.5 rounded-ctl border border-dashed border-line-strong bg-surface-2/40 space-y-1.5">
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              <label htmlFor="sim-days-input" className="text-xs font-semibold text-ink-soft">
                {t('admin.packages.simulator.daysLabel')}
              </label>
              <Badge variant="outline" size="xs" className="border-dashed">
                {t('admin.packages.simulator.fixedDaysPreviewBadge')}
              </Badge>
            </div>
            <Input
              id="sim-days-input"
              dir="ltr"
              inputMode="numeric"
              className="tnum"
              value={daysRaw}
              onChange={(e) => {
                hasEditedDaysRef.current = true;
                setDaysRaw(e.target.value);
              }}
            />
            {daysRaw !== String(defaultDays || 30) && (
              <button
                type="button"
                onClick={() => {
                  hasEditedDaysRef.current = false;
                  setDaysRaw(String(defaultDays || 30));
                }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-fg hover:underline tnum"
              >
                <RotateCcw className="w-3 h-3" />
                {t('admin.packages.simulator.resetToDefaultDays', {
                  days: formatNumber(defaultDays || 30),
                })}
              </button>
            )}
            {fieldError('durationDays') && (
              <p className="text-xs text-danger mt-1">{fieldError('durationDays')}</p>
            )}
          </div>

          <div className="sm:pt-5">
            <Button type="submit" variant="primary" size="md" loading={isSimulating} block>
              <Calculator className="w-4 h-4" />
              <span>
                {isSimulating
                  ? t('admin.packages.simulator.calculating')
                  : t('admin.packages.simulator.calculateButton')}
              </span>
            </Button>
          </div>
        </div>

        <div className="p-2.5 rounded-ctl border border-dashed border-line-strong bg-surface-2/45 text-[11px] text-ink-muted flex items-start gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ink-muted" />
          <div className="space-y-0.5 leading-relaxed">
            <p>
              {t('admin.packages.simulator.fixedDaysPreviewHint', {
                days: formatNumber(defaultDays || 30),
              })}
            </p>
            <p>{t('admin.packages.simulator.hintSaveFirst')}</p>
          </div>
        </div>
      </form>

      {result && (
        <div className="p-3 rounded-card bg-surface-2 border border-line space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="space-y-1">
              <div className="text-[11px] text-ink-muted">
                {t('admin.packages.simulator.totalPriceLabel')}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-extrabold text-brand-fg tnum">
                  {formatToman(result.quote.totalPrice)}
                </span>
                {priceDeltaVsBase > 0 && (
                  <Badge variant="success" size="xs" className="tnum">
                    {t('admin.packages.simulator.savingsVsBase', {
                      amount: formatMoney(priceDeltaVsBase),
                    })}
                  </Badge>
                )}
                {priceDeltaVsBase < 0 && (
                  <Badge variant="warning" size="xs" className="tnum">
                    {t('admin.packages.simulator.surchargeVsBase', {
                      amount: formatMoney(Math.abs(priceDeltaVsBase)),
                    })}
                  </Badge>
                )}
              </div>
            </div>

            <div className="text-end">
              <div className="text-[11px] text-ink-muted mb-1">
                {t('admin.packages.simulator.appliedSourceLabel')}
              </div>
              <Badge
                variant={
                  result.quote.overrideId ? 'warning' : result.quote.tierId ? 'success' : 'neutral'
                }
                size="sm"
              >
                {sourceBadge}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-line text-xs">
            <div className="bg-surface rounded-ctl px-2.5 py-1.5 border border-line/70">
              <div className="text-[11px] text-ink-muted">
                {t('admin.packages.simulator.volumeSubtotalLabel', {
                  rate: formatMoney(result.quote.pricePerGb),
                })}
              </div>
              <div className="font-bold text-ink tnum mt-0.5">
                {formatToman(result.quote.volumePrice)}
              </div>
            </div>

            <div
              className={`bg-surface rounded-ctl px-2.5 py-1.5 border ${
                result.quote.durationPrice === 0
                  ? 'border-dashed border-line-strong opacity-75'
                  : 'border-line/70'
              }`}
            >
              <div className="text-[11px] text-ink-muted">
                {t('admin.packages.simulator.durationSubtotalLabel', {
                  rate: formatMoney(result.quote.pricePerDay),
                })}
              </div>
              <div className="font-bold text-ink tnum mt-0.5">
                {formatToman(result.quote.durationPrice)}
              </div>
            </div>

            <div className="bg-surface rounded-ctl px-2.5 py-1.5 border border-line/70">
              <div className="text-[11px] text-ink-muted">
                {t('admin.packages.simulator.unitPriceLabel')}
              </div>
              <div className="font-bold text-ink tnum mt-0.5">
                {formatToman(computePackageUnitPrice(result.quote.totalPrice, result.gbAmount))}
              </div>
            </div>
          </div>

          {result.warnings.length > 0 && (
            <div className="space-y-1.5">
              {result.warnings.map((warnCode) => (
                <div
                  key={warnCode}
                  className="p-2 rounded-ctl bg-warn-soft border border-warn/30 text-warn text-xs flex items-start gap-1.5"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{renderWarningLabel(warnCode)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
