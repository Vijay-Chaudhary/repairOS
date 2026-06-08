'use client';

import { useRef, useState } from 'react';
import { Camera, X, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PhotoUploaderProps {
  value: string[];
  onChange: (urls: string[]) => void;
  maxFiles?: number;
  disabled?: boolean;
  className?: string;
}

export function PhotoUploader({ value, onChange, maxFiles = 10, disabled, className }: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList) {
    if (disabled || uploading) return;
    const remaining = maxFiles - value.length;
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length === 0) return;

    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of toUpload) {
        const objectUrl = URL.createObjectURL(file);
        urls.push(objectUrl);
      }
      onChange([...value, ...urls]);
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap gap-2">
        {value.map((url, i) => (
          <div key={url} className="relative group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-md object-cover border border-[var(--border)]" />
            {!disabled && (
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-[var(--danger)] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity min-h-[auto] min-w-[auto]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {value.length < maxFiles && !disabled && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="h-20 w-20 rounded-md border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-1 text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors min-h-[auto] min-w-[auto]"
          >
            {uploading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            ) : (
              <>
                <Camera className="h-5 w-5" />
                <span className="text-xs">Add</span>
              </>
            )}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
    </div>
  );
}
