import React, { useEffect, useState } from 'react';
import { AlertTriangle, Calculator } from 'lucide-react';
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
  isSimulating,
  result,
  onSimulate,
}) => {
  const { t } = useLanguage();
  const { formatMoney, formatToman } = useFormatters();

  const [gbRaw, setGbRaw] = useState(String(defaultGb || 50));
  const [daysRaw, setDaysRaw] = useState(String(defaultDays || 30));
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  useEffect(() => {
    setGbRaw(String(defaultGb || 50));
    setDaysRaw(String(defaultDays || 30));
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

  return (
    <Card padding="md" className="space-y-3">
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-tile bg-brand-soft border border-brand/20 flex items-center justify-center shrink-0">
          <Calculator className="w-4 h-4 text-brand" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{t('admin.packages.simulator.title')}</h3>
          <p className="text-2xs text-ink-muted mt-0.5">{t('admin.packages.simulator.subtitle')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
        <div>
          <label htmlFor="sim-gb-input" className="block text-xs font-semibold text-ink-soft mb-1">
            {t('admin.packages.simulator.gbLabel')}
          </label>
          <Input
            id="sim-gb-input"
            dir="ltr"
            inputMode="numeric"
            className="tnum"
            value={gbRaw}
            onChange={(e) => setGbRaw(e.target.value)}
          />
          {fieldError('gbAmount') && (
            <p className="text-xs text-danger mt-1">{fieldError('gbAmount')}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="sim-days-input"
            className="block text-xs font-semibold text-ink-soft mb-1"
          >
            {t('admin.packages.simulator.daysLabel')}
          </label>
          <Input
            id="sim-days-input"
            dir="ltr"
            inputMode="numeric"
            className="tnum"
            value={daysRaw}
            onChange={(e) => setDaysRaw(e.target.value)}
          />
          {fieldError('durationDays') && (
            <p className="text-xs text-danger mt-1">{fieldError('durationDays')}</p>
          )}
        </div>

        <Button type="submit" variant="primary" size="md" loading={isSimulating} block>
          <Calculator className="w-4 h-4" />
          <span>
            {isSimulating
              ? t('admin.packages.simulator.calculating')
              : t('admin.packages.simulator.calculateButton')}
          </span>
        </Button>
      </form>

      <p className="text-2xs text-ink-muted">{t('admin.packages.simulator.hintSaveFirst')}</p>

      {result && (
        <div className="p-3 rounded-card bg-surface-2 border border-line space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-2xs text-ink-muted">
                {t('admin.packages.simulator.totalPriceLabel')}
              </div>
              <div className="text-lg font-extrabold text-brand tnum">
                {formatToman(result.quote.totalPrice)}
              </div>
            </div>

            <div className="text-end">
              <div className="text-2xs text-ink-muted mb-1">
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
              <div className="text-2xs text-ink-muted">
                {t('admin.packages.simulator.volumeSubtotalLabel', {
                  rate: formatMoney(result.quote.pricePerGb),
                })}
              </div>
              <div className="font-bold text-ink tnum mt-0.5">
                {formatToman(result.quote.volumePrice)}
              </div>
            </div>

            <div className="bg-surface rounded-ctl px-2.5 py-1.5 border border-line/70">
              <div className="text-2xs text-ink-muted">
                {t('admin.packages.simulator.durationSubtotalLabel', {
                  rate: formatMoney(result.quote.pricePerDay),
                })}
              </div>
              <div className="font-bold text-ink tnum mt-0.5">
                {formatToman(result.quote.durationPrice)}
              </div>
            </div>

            <div className="bg-surface rounded-ctl px-2.5 py-1.5 border border-line/70">
              <div className="text-2xs text-ink-muted">
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
