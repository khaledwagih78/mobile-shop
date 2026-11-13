'use client';
import { useState } from 'react';

export function ShareButtons({ url, title, text }: { url: string; title: string; text?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <button className="btn-secondary" onClick={async () => {
        if (navigator.share) {
          try { await navigator.share({ title, text, url }); } catch { /* user cancelled */ }
        } else {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }
      }}>📤 مشاركة</button>
      <button className="btn-secondary" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }}>
        {copied ? '✔ اتنسخ' : '🔗 نسخ الرابط'}
      </button>
    </div>
  );
}
