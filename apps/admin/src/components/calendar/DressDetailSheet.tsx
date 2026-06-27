import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Package } from 'lucide-react';
import { SLOT_STATES, type SlotState } from '@cutebunny/shared/calendar-state-machine';
import { StatusPill, STATUS_CONFIG } from './StatusPill';
import type { DayDressRow } from '@/lib/hooks/useCalendarDay';

interface DressDetailSheetProps {
  item: DayDressRow;
  selectedDate: string;
  onClose: () => void;
  onStatusChange: (to: SlotState) => void;
}

export function DressDetailSheet({
  item,
  selectedDate,
  onClose,
  onStatusChange,
}: DressDetailSheetProps) {
  const { t } = useTranslation();
  const sheetRef = useRef<HTMLDivElement>(null);
  const { row, status } = item;

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={row.display_name}
        className="fixed inset-x-0 bottom-0 z-50 bg-background rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-200"
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-4 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            {row.thumbnail ? (
              <img
                src={row.thumbnail}
                alt={row.display_name}
                className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                <Package className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-base font-semibold truncate">{row.display_name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {row.sku}
                {row.brand ? ` · ${row.brand}` : ''}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedDate}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Current status */}
        <div className="px-4 pb-3">
          <p className="text-xs text-muted-foreground mb-1">
            {t('calendar.mobile.currentStatus')}
          </p>
          <StatusPill status={status} size="md" />
        </div>

        {/* Status options */}
        <div className="px-4 pb-6">
          <p className="text-xs text-muted-foreground mb-2">
            {t('calendar.mobile.changeStatus')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SLOT_STATES.map((s) => {
              const config = STATUS_CONFIG[s];
              const Icon = config.icon;
              const isActive = s === status;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onStatusChange(s)}
                  className={`
                    flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-medium
                    min-h-[48px] transition-colors text-left
                    ${isActive ? `${config.bg} ${config.text} ring-2 ring-current` : `${config.bg} ${config.text} opacity-70 hover:opacity-100`}
                  `}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
                  <span className="truncate">{t(`calendar.status.${s}`)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
