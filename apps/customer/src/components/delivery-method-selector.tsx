'use client';

import { useTranslations } from 'next-intl';
import { Package, Bike } from 'lucide-react';

export type DeliveryMethodType = 'standard' | 'messenger';

interface DeliveryMethodSelectorProps {
  value: DeliveryMethodType;
  onChange: (method: DeliveryMethodType) => void;
  messengerEnabled: boolean;
  messengerEstimate?: {
    available: boolean;
    fee: number;
    distance_km: number;
    estimated_minutes: number;
    reason?: string;
  } | null;
  disabled?: boolean;
}

export function DeliveryMethodSelector({
  value,
  onChange,
  messengerEnabled,
  messengerEstimate,
  disabled,
}: DeliveryMethodSelectorProps) {
  const t = useTranslations('delivery');

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t('selectMethod')}</h3>
      <div className="grid grid-cols-2 gap-3">
        {/* Standard */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('standard')}
          className={`rounded-lg border-2 p-3 text-left transition-colors ${
            value === 'standard'
              ? 'border-primary bg-primary/5'
              : 'border-muted hover:border-muted-foreground/30'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{t('standard')}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('standardDesc')}</p>
        </button>

        {/* Messenger */}
        <button
          type="button"
          disabled={disabled || !messengerEnabled}
          onClick={() => messengerEnabled && onChange('messenger')}
          className={`rounded-lg border-2 p-3 text-left transition-colors ${
            value === 'messenger'
              ? 'border-primary bg-primary/5'
              : 'border-muted hover:border-muted-foreground/30'
          } ${!messengerEnabled || disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Bike className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{t('messenger')}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('messengerDesc')}</p>
          {messengerEnabled && (
            <p className="text-xs text-muted-foreground mt-1">
              {t('messengerPayNote')}
            </p>
          )}
          {messengerEstimate?.available && (
            <p className="text-xs font-medium text-primary mt-1">
              ~{messengerEstimate.estimated_minutes} {t('min')}
            </p>
          )}
          {messengerEstimate && !messengerEstimate.available && (
            <p className="text-xs text-destructive mt-1">{t('messengerUnavailable')}</p>
          )}
          {!messengerEnabled && (
            <p className="text-xs text-muted-foreground mt-1">{t('messengerDisabled')}</p>
          )}
        </button>
      </div>
    </div>
  );
}

interface ReturnMethodDisplayProps {
  rentalDays: number;
}

export function ReturnMethodDisplay({
  rentalDays,
}: ReturnMethodDisplayProps) {
  const t = useTranslations('delivery');

  const returnMethod = rentalDays === 1 ? 'messenger' : 'standard';

  return (
    <div className="rounded-lg border p-3 bg-muted/30">
      <div className="flex items-center gap-2">
        {returnMethod === 'messenger' ? (
          <Bike className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Package className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">{t('returnMethod')}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {returnMethod === 'messenger' ? (
          <>
            {t('returnMessengerRequired')}
            {' ('}{t('returnMessengerPayNote')}{')'}
          </>
        ) : (
          t('returnStandard')
        )}
      </p>
    </div>
  );
}
