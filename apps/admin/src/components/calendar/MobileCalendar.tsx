import { useTranslation } from 'react-i18next';
import type { CalendarUnitRow } from '@/lib/api';

interface MobileCalendarProps {
  startDate: string;
  rawRows: CalendarUnitRow[] | undefined;
  isLoading: boolean;
  monthName: string;
  canGoNext: boolean;
  prevMonth: () => void;
  nextMonth: () => void;
}

export function MobileCalendar({
  isLoading,
  monthName,
  canGoNext,
  prevMonth,
  nextMonth,
}: MobileCalendarProps) {
  const { t } = useTranslation();

  return (
    <div className="px-1">
      <h1 className="text-xl font-bold mb-4">{t('calendar.title')}</h1>
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-2 hover:bg-muted rounded">
          &larr;
        </button>
        <h2 className="text-base font-semibold">{monthName}</h2>
        <button
          onClick={nextMonth}
          className={`p-2 rounded ${canGoNext ? 'hover:bg-muted' : 'opacity-30 cursor-not-allowed'}`}
          disabled={!canGoNext}
        >
          &rarr;
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          {t('common.loading')}
        </div>
      ) : (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          {t('calendar.noData')}
        </div>
      )}
    </div>
  );
}
