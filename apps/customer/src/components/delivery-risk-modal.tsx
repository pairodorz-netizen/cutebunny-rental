'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

export type DeliveryRiskVariant = 'delivery' | 'queueCollision';

interface DeliveryRiskModalProps {
  open: boolean;
  variant?: DeliveryRiskVariant;
  onAccept: () => void;
  onCancel: () => void;
}

export function DeliveryRiskModal({ open, variant = 'delivery', onAccept, onCancel }: DeliveryRiskModalProps) {
  const t = useTranslations('delivery');

  if (!open) return null;

  const titleKey = variant === 'queueCollision' ? 'queueCollisionTitle' : 'riskTitle';
  const messageKey = variant === 'queueCollision' ? 'queueCollisionMessage' : 'riskMessage';
  const acceptKey = variant === 'queueCollision' ? 'queueCollisionAccept' : 'riskAccept';
  const cancelKey = variant === 'queueCollision' ? 'queueCollisionCancel' : 'riskCancel';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold text-cb-heading">{t(titleKey)}</h3>
        </div>

        <p className="text-sm text-cb-secondary leading-relaxed">
          {t(messageKey)}
        </p>

        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={onCancel}
            className="w-full px-4 py-2.5 rounded-full border-2 border-cb-active text-cb-active font-medium text-sm hover:bg-cb-active/5 transition-colors"
          >
            {t(cancelKey)}
          </button>
          <button
            onClick={onAccept}
            className="w-full px-4 py-2.5 rounded-full bg-amber-500 text-white font-medium text-sm hover:bg-amber-600 transition-colors"
          >
            {t(acceptKey)}
          </button>
        </div>
      </div>
    </div>
  );
}
