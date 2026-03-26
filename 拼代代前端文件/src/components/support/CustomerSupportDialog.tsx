import { useEffect } from 'react';
import { X } from 'lucide-react';
import CustomerSupportPanel from './CustomerSupportPanel';

interface CustomerSupportDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function CustomerSupportDialog({ open, onClose }: CustomerSupportDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 py-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="联系客服"
    >
      <div
        className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label="关闭联系客服弹窗"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-5 pr-10">
          <h2 className="text-2xl font-bold text-gray-900">联系客服</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            遇到登录、充值、任务或下载问题时，直接扫码添加客服微信即可。
          </p>
        </div>

        <CustomerSupportPanel
          showCopyButton
          note="如扫码不方便，也可以直接复制上面的微信号添加。"
          imageClassName="mx-auto w-64 max-w-full rounded-2xl border border-gray-200 shadow-sm"
        />
      </div>
    </div>
  );
}
