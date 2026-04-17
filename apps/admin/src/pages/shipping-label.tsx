import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, Printer } from 'lucide-react';

const CARRIERS = [
  { code: 'kerry', name: 'Kerry Express' },
  { code: 'thailand_post', name: 'Thailand Post' },
  { code: 'flash', name: 'Flash Express' },
  { code: 'jt', name: 'J&T Express' },
];

function QRCode({ data, size = 100 }: { data: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellSize = Math.floor(size / 25);
    const modules = 25;
    canvas.width = cellSize * modules;
    canvas.height = cellSize * modules;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';

    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
    }

    const drawFinder = (x: number, y: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
          const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          if (isOuter || isInner) {
            ctx.fillRect((x + c) * cellSize, (y + r) * cellSize, cellSize, cellSize);
          }
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(modules - 7, 0);
    drawFinder(0, modules - 7);

    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if ((r < 8 && c < 8) || (r < 8 && c >= modules - 8) || (r >= modules - 8 && c < 8)) continue;
        const bit = ((hash * (r * modules + c + 1)) >>> 0) % 3;
        if (bit === 0) {
          ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        }
      }
    }
  }, [data, size]);

  return <canvas ref={canvasRef} style={{ width: size, height: size, imageRendering: 'pixelated' }} />;
}

// A6 print styles injected globally
const A6_PRINT_STYLE = `
@media print {
  @page {
    size: 105mm 148mm;
    margin: 4mm;
  }
  body * { visibility: hidden !important; }
  #a6-label, #a6-label * { visibility: visible !important; }
  #a6-label {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 97mm !important;
    height: 140mm !important;
    margin: 0 !important;
    padding: 3mm !important;
    background: white !important;
    color: black !important;
    font-size: 9pt !important;
    line-height: 1.3 !important;
    overflow: hidden !important;
  }
  #a6-label .label-header { font-size: 12pt !important; }
  #a6-label .label-tracking { font-size: 11pt !important; }
  #a6-label .label-recipient-name { font-size: 11pt !important; }
  #a6-label .label-small { font-size: 7pt !important; }
  #a6-label .label-qr canvas { width: 80px !important; height: 80px !important; }
}
`;

export function ShippingLabelPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedCarrier, setSelectedCarrier] = useState('');
  const [trackingInput, setTrackingInput] = useState('');

  // Inject print styles
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = A6_PRINT_STYLE;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['shipping-label', id],
    queryFn: () => adminApi.orders.shippingLabel(id!),
    enabled: !!id,
  });

  const carrierMutation = useMutation({
    mutationFn: (body: { carrier_code: string; tracking_number?: string }) =>
      adminApi.shipping.setCarrier(id!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-label', id] });
    },
  });

  const label = data?.data;

  useEffect(() => {
    if (label?.carrier) {
      setSelectedCarrier(label.carrier.code);
    }
    if (label?.tracking_number) {
      setTrackingInput(label.tracking_number);
    }
  }, [label]);

  const handlePrint = () => {
    window.print();
  };

  const handleSaveCarrier = () => {
    if (!selectedCarrier) return;
    carrierMutation.mutate({
      carrier_code: selectedCarrier,
      tracking_number: trackingInput || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (!label) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {t('shipping.notFound')}
      </div>
    );
  }

  const carrierName = CARRIERS.find((c) => c.code === selectedCarrier)?.name ?? label.carrier?.name ?? '';

  // Format Thai address (Thai convention: address, subdistrict, district, province postal_code)
  const recipientAddress = [
    label.recipient.address,
    label.recipient.subdistrict && `ต.${label.recipient.subdistrict}`,
    label.recipient.district && `อ.${label.recipient.district}`,
    label.recipient.province && `จ.${label.recipient.province}`,
    label.recipient.postal_code,
  ].filter(Boolean).join(' ');

  return (
    <div>
      {/* Controls - hidden when printing */}
      <div className="print:hidden mb-6 space-y-4">
        <button
          onClick={() => navigate('/orders')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="h-4 w-4" /> {t('orders.backToList')}
        </button>

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t('shipping.labelTitle')} — {label.order_number}</h1>
          <span className="text-xs bg-muted px-2 py-1 rounded">{t('shipping.a6Format')}</span>
        </div>

        <div className="rounded-lg border p-4 space-y-4 max-w-lg">
          <div>
            <label className="text-sm font-medium">{t('shipping.carrier')}</label>
            <select
              value={selectedCarrier}
              onChange={(e) => setSelectedCarrier(e.target.value)}
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('shipping.selectCarrier')}</option>
              {CARRIERS.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">{t('orders.trackingNumber')}</label>
            <Input
              value={trackingInput}
              onChange={(e) => setTrackingInput(e.target.value)}
              placeholder="e.g. TH12345678901"
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSaveCarrier}
              disabled={!selectedCarrier || carrierMutation.isPending}
            >
              {carrierMutation.isPending ? t('common.loading') : t('shipping.saveCarrier')}
            </Button>
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" /> {t('shipping.printA6')}
            </Button>
          </div>
        </div>
      </div>

      {/* A6 Printable Label (105mm × 148mm) */}
      <div
        id="a6-label"
        className="border-2 border-black rounded-lg bg-white text-black mx-auto"
        style={{ width: '105mm', minHeight: '148mm', padding: '4mm', fontFamily: "'Sarabun', 'Noto Sans Thai', sans-serif" }}
      >
        {/* Top bar: Order # + Carrier */}
        <div className="flex items-center justify-between border-b-2 border-black pb-2 mb-2">
          <div>
            <p className="label-header font-bold text-base tracking-tight">CuteBunny Rental</p>
            <p className="label-small text-[8px] text-gray-500">ร้านให้เช่าชุดราตรี</p>
          </div>
          <div className="text-right">
            <p className="font-mono font-bold text-xs">{label.order_number}</p>
            {carrierName && (
              <p className="text-[10px] font-semibold bg-black text-white px-1.5 py-0.5 rounded mt-0.5 inline-block">
                {carrierName}
              </p>
            )}
          </div>
        </div>

        {/* Sender (compact) */}
        <div className="mb-2 pb-2 border-b border-dashed border-gray-400">
          <p className="text-[8px] font-bold uppercase text-gray-400 mb-0.5">{t('shipping.from')}</p>
          <p className="text-[10px]">
            <span className="font-semibold">{label.sender.name}</span> · {label.sender.phone}
          </p>
          <p className="text-[9px] text-gray-600">{label.sender.address}</p>
        </div>

        {/* Recipient (prominent) */}
        <div className="border-2 border-black rounded p-2 mb-2 bg-gray-50">
          <p className="text-[8px] font-bold uppercase text-gray-400 mb-1">{t('shipping.to')} / ผู้รับ</p>
          <p className="label-recipient-name font-bold text-sm mb-0.5">{label.recipient.name}</p>
          <p className="text-[11px] font-semibold">{label.recipient.phone}</p>
          <p className="text-[10px] mt-1 leading-snug">{recipientAddress}</p>
        </div>

        {/* QR + Tracking row */}
        <div className="flex items-start gap-3 border-b border-dashed border-gray-400 pb-2 mb-2">
          <div className="label-qr shrink-0">
            <QRCode data={label.qr_data} size={80} />
          </div>
          <div className="flex-1">
            <p className="text-[8px] text-gray-400 uppercase">{t('shipping.trackingNumber')}</p>
            <p className="label-tracking font-mono font-bold text-sm tracking-wider">
              {label.tracking_number ?? t('shipping.pending')}
            </p>
            <div className="mt-1.5 grid grid-cols-2 gap-x-2">
              <div>
                <p className="text-[7px] text-gray-400">{t('shipping.rentalPeriod')}</p>
                <p className="text-[9px] font-medium">{label.rental_period.start}</p>
              </div>
              <div>
                <p className="text-[7px] text-gray-400">{t('shipping.returnBy')}</p>
                <p className="text-[9px] font-bold text-red-600">{label.rental_period.end}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Items table */}
        <div className="mb-2">
          <p className="text-[8px] font-bold uppercase text-gray-400 mb-1">{t('shipping.contents')} / รายการ</p>
          <table className="w-full text-[9px]">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-0.5 font-medium">{t('shipping.item')}</th>
                <th className="text-left py-0.5 font-medium">{t('shipping.size')}</th>
                <th className="text-right py-0.5 font-medium">{t('shipping.qty')}</th>
              </tr>
            </thead>
            <tbody>
              {label.items.map((item, idx) => (
                <tr key={idx} className="border-b border-dashed border-gray-200">
                  <td className="py-0.5">{item.name}</td>
                  <td className="py-0.5">{item.size}</td>
                  <td className="py-0.5 text-right">{item.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="text-center border-t border-gray-300 pt-1">
          <p className="text-[8px] font-semibold text-gray-500">{t('shipping.handleWithCare')}</p>
          <p className="text-[7px] text-gray-400 mt-0.5">{t('shipping.returnAddress')}: {label.sender.address}</p>
        </div>
      </div>
    </div>
  );
}
