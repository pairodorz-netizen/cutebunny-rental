import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

interface MobileTopBarProps {
  monthName: string;
  canGoNext: boolean;
  prevMonth: () => void;
  nextMonth: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

export function MobileTopBar({
  monthName,
  canGoNext,
  prevMonth,
  nextMonth,
  searchQuery,
  onSearchChange,
}: MobileTopBarProps) {
  const { t } = useTranslation();

  return (
    <div className="sticky top-0 z-20 bg-background pb-2">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevMonth}
          className="p-2 hover:bg-muted rounded min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label={t('calendar.mobile.prevMonth')}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-base font-semibold">{monthName}</h2>
        <button
          onClick={nextMonth}
          className={`p-2 rounded min-w-[44px] min-h-[44px] flex items-center justify-center ${canGoNext ? 'hover:bg-muted' : 'opacity-30 cursor-not-allowed'}`}
          disabled={!canGoNext}
          aria-label={t('calendar.mobile.nextMonth')}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('calendar.mobile.search')}
          className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background"
        />
      </div>
    </div>
  );
}
