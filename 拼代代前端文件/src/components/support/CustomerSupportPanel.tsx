import { useState } from 'react';
import { Mail, MessageSquare, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import { CUSTOMER_SUPPORT } from '../../lib/customerSupport';

interface CustomerSupportPanelProps {
  showCopyButton?: boolean;
  note?: string;
  imageClassName?: string;
}

export default function CustomerSupportPanel({
  showCopyButton = false,
  note,
  imageClassName = 'w-56 max-w-full rounded-2xl border border-gray-200 shadow-sm',
}: CustomerSupportPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CUSTOMER_SUPPORT.wechatId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert(`请手动复制微信号：${CUSTOMER_SUPPORT.wechatId}`);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <img
        src={CUSTOMER_SUPPORT.qrImageSrc}
        alt={`${CUSTOMER_SUPPORT.teamName}二维码`}
        className={imageClassName}
      />

      <div className="mt-4 text-center">
        <p className="text-base font-semibold text-gray-900">{CUSTOMER_SUPPORT.teamName}</p>
        <p className="mt-1 text-sm text-gray-500">{CUSTOMER_SUPPORT.subtitle}</p>
      </div>

      <div className="mt-5 w-full max-w-sm space-y-3">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <div className="flex items-center justify-center gap-2 font-medium text-gray-700">
            <MessageSquare className="h-4 w-4 text-green-600" />
            官方微信号
          </div>
          <div className="mt-1 text-center font-mono text-lg font-bold text-gray-900">
            {CUSTOMER_SUPPORT.wechatId}
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
          <Mail className="h-4 w-4 text-red-700" />
          <span>{CUSTOMER_SUPPORT.email}</span>
        </div>

        {showCopyButton && (
          <Button type="button" className="w-full shadow-sm" onClick={handleCopy}>
            {copied ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                微信号已复制
              </>
            ) : (
              '复制微信号'
            )}
          </Button>
        )}
      </div>

      {note && <p className="mt-4 text-center text-xs leading-relaxed text-gray-500">{note}</p>}
    </div>
  );
}
