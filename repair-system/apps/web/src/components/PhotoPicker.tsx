'use client';
import { useEffect, useState } from 'react';

/** يصوّر بالكاميرا (على الموبايل) أو يختار من الجهاز، مع معاينة وحذف. */
export function PhotoPicker({ files, onChange, max = 10 }: { files: File[]; onChange: (f: File[]) => void; max?: number }) {
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="btn-secondary cursor-pointer">
          📷 صوّر
          <input type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, max)); e.target.value = ''; }} />
        </label>
        <label className="btn-secondary cursor-pointer">
          🖼️ اختار صور
          <input type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, max)); e.target.value = ''; }} />
        </label>
        <span className="self-center text-sm text-slate-500">{files.length}/{max}</span>
      </div>
      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {previews.map((u, i) => (
            <div key={u} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`صورة ${i + 1}`} className="aspect-square w-full rounded-lg object-cover" />
              <button type="button" aria-label="حذف الصورة"
                className="absolute left-1 top-1 h-7 w-7 rounded-full bg-black/60 text-white"
                onClick={() => onChange(files.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
