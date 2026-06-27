import { useEffect, useRef } from 'react';
import { dayOfMonth } from '@cutebunny/shared/calendar-dates';

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface DayStripProps {
  dates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

export function DayStrip({ dates, selectedDate, onSelectDate }: DayStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selectedRef.current && scrollRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [selectedDate]);

  return (
    <div className="sticky top-[108px] z-10 bg-background py-2">
      <div
        ref={scrollRef}
        className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {dates.map((date) => {
          const day = dayOfMonth(date);
          const jsDate = new Date(date + 'T00:00:00');
          const dayName = DAY_NAMES_SHORT[jsDate.getDay()];
          const isSelected = date === selectedDate;
          const isToday =
            date ===
            new Date().toISOString().split('T')[0];

          return (
            <button
              key={date}
              ref={isSelected ? selectedRef : undefined}
              onClick={() => onSelectDate(date)}
              className={`
                flex flex-col items-center justify-center flex-shrink-0
                rounded-xl transition-colors
                ${isSelected ? 'bg-primary text-primary-foreground' : isToday ? 'bg-muted ring-1 ring-primary' : 'bg-muted/50 hover:bg-muted'}
              `}
              style={{ minWidth: 48, minHeight: 60 }}
            >
              <span className="text-[10px] font-medium leading-tight">
                {dayName}
              </span>
              <span className="text-lg font-bold leading-tight">{day}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
