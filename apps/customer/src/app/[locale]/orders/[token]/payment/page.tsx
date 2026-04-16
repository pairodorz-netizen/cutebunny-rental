'use client';

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { Upload, CheckCircle, ArrowLeft } from 'lucide-react';

export default function PaymentUploadPage() {
  const t = useTranslations('payment');
  const params = useParams();
  const token = params.token as string;
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [bankName, setBankName] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    const validTypes = ['image/jpeg', 'image/png'];
    if (!validTypes.includes(f.type)) {
      setError(t('invalidFileType'));
      return;
    }

    if (f.size > 10 * 1024 * 1024) {
      setError(t('fileTooLarge'));
      return;
    }

    setFile(f);
    setError(null);
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !amount) return;

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('declared_amount', amount);
      formData.append('bank_name', bankName);

      const result = await api.orders.uploadSlip(token, formData);
      if (result.error) {
        setError(result.error.message);
      } else {
        setSuccess(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('uploadError'));
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="container py-16 text-center max-w-md mx-auto">
        <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">{t('successTitle')}</h1>
        <p className="text-muted-foreground mb-6">{t('successDesc')}</p>
        <Button asChild>
          <Link href={`/orders/${token}`}>{t('viewOrderStatus')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container py-8 max-w-lg mx-auto">
      <Link href={`/orders/${token}`} className="text-sm text-muted-foreground hover:text-primary mb-6 inline-flex items-center gap-1">
        <ArrowLeft className="h-3 w-3" /> {t('backToOrder')}
      </Link>

      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* File Upload */}
        <div>
          <label className="text-sm font-medium">{t('paymentSlip')}</label>
          <div
            onClick={() => fileRef.current?.click()}
            className="mt-2 border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
          >
            {preview ? (
              <img src={preview} alt="Payment slip" className="max-h-48 mx-auto rounded" />
            ) : (
              <div className="text-muted-foreground">
                <Upload className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm">{t('dropOrClick')}</p>
                <p className="text-xs mt-1">{t('fileTypes')}</p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Amount */}
        <div>
          <label className="text-sm font-medium">{t('amount')}</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            required
          />
        </div>

        {/* Bank Name */}
        <div>
          <label className="text-sm font-medium">{t('bankName')}</label>
          <select
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{t('selectBank')}</option>
            <option value="KBank">KBank</option>
            <option value="SCB">SCB</option>
            <option value="Bangkok Bank">Bangkok Bank</option>
            <option value="Krungsri">Krungsri</option>
            <option value="TMBThanachart">TMBThanachart</option>
          </select>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
        )}

        <Button type="submit" disabled={loading || !file || !amount} className="w-full">
          {loading ? t('uploading') : t('submit')}
        </Button>
      </form>
    </div>
  );
}
