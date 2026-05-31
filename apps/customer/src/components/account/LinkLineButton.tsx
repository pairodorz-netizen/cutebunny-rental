'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { encodeIntent } from '@/lib/auth/intent';
import { getStoredToken } from '@/lib/auth/token';
import { Check, AlertCircle, AlertTriangle } from 'lucide-react';

interface LinkLineButtonProps {
  hasLineIdentity: boolean;
}

export function LinkLineButton({ hasLineIdentity }: LinkLineButtonProps) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [showMergeModal, setShowMergeModal] = useState(false);

  const lineLinked = searchParams.get('line_linked') === 'true';
  const lineError = searchParams.get('line_error');
  const lineAlreadyLinked = searchParams.get('line_error') === 'line_already_linked';

  if (hasLineIdentity || lineLinked) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600">
        <Check className="h-4 w-4" />
        <span>{t('lineLinked')}</span>
      </div>
    );
  }

  const handleLinkLine = () => {
    const token = getStoredToken();
    if (token) {
      document.cookie = `cb_customer_token=${token}; Path=/; SameSite=Lax; Secure; Max-Age=300`;
    }
    const intent = encodeIntent({ returnPath: `/${locale}/profile` });
    window.location.href = `/api/v1/customer/auth/line/start?link=1&intent=${intent}`;
  };

  const handleMerge = () => {
    const token = getStoredToken();
    if (token) {
      document.cookie = `cb_customer_token=${token}; Path=/; SameSite=Lax; Secure; Max-Age=300`;
    }
    const intent = encodeIntent({ returnPath: `/${locale}/profile` });
    window.location.href = `/api/v1/customer/auth/line/start?link=1&merge=1&intent=${intent}`;
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleLinkLine}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ backgroundColor: '#06C755' }}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.5 8.84C17.5 5.27 14.14 2.37 10 2.37C5.86 2.37 2.5 5.27 2.5 8.84C2.5 12.05 5.18 14.72 8.84 15.23C9.09 15.28 9.43 15.4 9.52 15.62C9.6 15.82 9.57 16.13 9.55 16.33L9.45 16.94C9.41 17.18 9.27 17.82 10.01 17.51C10.75 17.19 14.05 15.15 15.59 13.37C16.69 12.15 17.5 10.58 17.5 8.84Z" fill="white"/>
        </svg>
        {t('linkLine')}
      </button>

      {lineAlreadyLinked && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{t('lineAlreadyLinkedError')}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowMergeModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 transition-colors"
          >
            <AlertTriangle className="h-4 w-4" />
            {t('lineMergeButton')}
          </button>
        </div>
      )}

      {lineError && !lineAlreadyLinked && (
        <div className="flex items-center gap-2 text-sm text-red-500">
          <AlertCircle className="h-4 w-4" />
          <span>{lineError}</span>
        </div>
      )}

      {/* Merge confirmation modal */}
      {showMergeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold text-cb-heading">
                {t('lineMergeConfirmTitle')}
              </h3>
            </div>
            <p className="text-sm text-cb-secondary mb-6 leading-relaxed">
              {t('lineMergeConfirmBody')}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-cb-heading hover:bg-cb-surface transition-colors"
              >
                {t('lineMergeCancel')}
              </button>
              <button
                type="button"
                onClick={handleMerge}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: '#06C755' }}
              >
                {t('lineMergeConfirmBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
