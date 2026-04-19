import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface UnitSwitcherProps {
  currentUnit: string; // 'all' | '1' | '2' | ...
  totalUnits: number;
  onUnitChange: (unit: string) => void;
}

export function UnitSwitcher({ currentUnit, totalUnits, onUnitChange }: UnitSwitcherProps) {
  const { t } = useTranslation();

  const prev = useCallback(() => {
    if (currentUnit === 'all') {
      onUnitChange(String(totalUnits));
    } else {
      const cur = parseInt(currentUnit, 10);
      onUnitChange(cur <= 1 ? 'all' : String(cur - 1));
    }
  }, [currentUnit, totalUnits, onUnitChange]);

  const next = useCallback(() => {
    if (currentUnit === 'all') {
      onUnitChange(totalUnits > 0 ? '1' : 'all');
    } else {
      const cur = parseInt(currentUnit, 10);
      onUnitChange(cur >= totalUnits ? 'all' : String(cur + 1));
    }
  }, [currentUnit, totalUnits, onUnitChange]);

  const label = currentUnit === 'all'
    ? t('calendar.allUnits')
    : t('calendar.unitXofN', { x: currentUnit, n: totalUnits });

  if (totalUnits <= 0) return null;

  return (
    <div className="flex items-center justify-center gap-2 mb-3 py-1 bg-muted/30 rounded">
      <button
        onClick={prev}
        className="p-1 hover:bg-muted rounded"
        aria-label={t('calendar.prevUnit')}
        data-testid="cal-unit-prev"
      >
        <ChevronLeft className="h-3 w-3" />
      </button>
      <span className="text-xs font-medium min-w-[100px] text-center" data-testid="cal-unit-label">
        {label}
      </span>
      <button
        onClick={next}
        className="p-1 hover:bg-muted rounded"
        aria-label={t('calendar.nextUnit')}
        data-testid="cal-unit-next"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}
