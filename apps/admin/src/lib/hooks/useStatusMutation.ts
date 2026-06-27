import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import type { CalendarUnitRow } from '@/lib/api';
import {
  canTransition,
  SLOT_STATE_LABELS,
  type SlotState,
} from '@cutebunny/shared/calendar-state-machine';

interface MutateParams {
  row: CalendarUnitRow;
  date: string;
  from: SlotState;
  to: SlotState;
}

export function useStatusMutation(queryKey: readonly unknown[]) {
  const queryClient = useQueryClient();

  const mutate = useCallback(
    async (params: MutateParams): Promise<boolean> => {
      const { row, date, from, to } = params;
      const transition = canTransition(from, to);
      if ('noop' in transition && transition.noop) return false;

      let confirmed = false;
      if ('confirm' in transition && transition.confirm) {
        if (!window.confirm(transition.reason ?? `Change state to "${SLOT_STATE_LABELS[to]}"?`)) {
          return false;
        }
        confirmed = true;
      }

      const snapshot = queryClient.getQueryData<{ data: CalendarUnitRow[] } | undefined>(queryKey);
      queryClient.setQueryData<{ data: CalendarUnitRow[] } | undefined>(queryKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          data: prev.data.map((r) => {
            if (r.product_id !== row.product_id || r.unit_index !== row.unit_index) return r;
            const otherSlots = r.slots.filter((s) => s.date !== date);
            return {
              ...r,
              slots: [
                ...otherSlots,
                { date, status: to, order_id: null, unit_index: r.unit_index },
              ],
            };
          }),
        };
      });

      try {
        await adminApi.calendar.patchCell({
          product_id: row.product_id,
          date,
          unit_index: row.unit_index,
          new_state: to,
          confirmed,
        });
        queryClient.invalidateQueries({ queryKey: [...queryKey] });
        return true;
      } catch (e) {
        queryClient.setQueryData(queryKey, snapshot);
        // eslint-disable-next-line no-alert
        window.alert(`Failed to update slot: ${(e as Error).message}`);
        return false;
      }
    },
    [queryClient, queryKey],
  );

  return mutate;
}
