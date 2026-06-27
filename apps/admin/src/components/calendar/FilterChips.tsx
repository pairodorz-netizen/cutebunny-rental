import { useTranslation } from 'react-i18next';
import { SLOT_STATES, type SlotState } from '@cutebunny/shared/calendar-state-machine';
import { STATUS_CONFIG } from './StatusPill';

interface FilterChipsProps {
  statusCounts: Record<SlotState, number>;
  totalCount: number;
  activeFilter: SlotState | null;
  onFilterChange: (status: SlotState | null) => void;
}

export function FilterChips({
  statusCounts,
  totalCount,
  activeFilter,
  onFilterChange,
}: FilterChipsProps) {
  const { t } = useTranslation();

  return (
    <div className="py-2">
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        <button
          onClick={() => onFilterChange(null)}
          className={`
            flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium
            min-h-[36px] transition-colors
            ${activeFilter === null ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-muted/80'}
          `}
        >
          {t('calendar.mobile.allStatuses')} ({totalCount})
        </button>
        {SLOT_STATES.map((status) => {
          const count = statusCounts[status];
          if (count === 0) return null;
          const config = STATUS_CONFIG[status];
          const isActive = activeFilter === status;
          return (
            <button
              key={status}
              onClick={() => onFilterChange(isActive ? null : status)}
              className={`
                flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium
                min-h-[36px] transition-colors
                ${isActive ? `${config.bg} ${config.text} ring-2 ring-offset-1 ring-current` : `${config.bg} ${config.text} opacity-80 hover:opacity-100`}
              `}
            >
              {t(`calendar.status.${status}`)} ({count})
            </button>
          );
        })}
      </div>
    </div>
  );
}
