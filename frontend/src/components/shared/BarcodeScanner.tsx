'use client';

import { useRef, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BarcodeScannerProps {
  onDetect: (code: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onDetect, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const readerRef = useRef<unknown>(null);

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;
        if (!videoRef.current) return;
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const deviceId = devices.find((d) => /back|rear|environment/i.test(d.label))?.deviceId;
        await reader.decodeFromVideoDevice(deviceId ?? undefined, videoRef.current, (result) => {
          if (result && active) {
            onDetect(result.getText());
          }
        });
      } catch {
        setError('Camera access denied or not available.');
      }
    }

    start();

    return () => {
      active = false;
      if (readerRef.current && typeof (readerRef.current as { reset?: () => void }).reset === 'function') {
        (readerRef.current as { reset: () => void }).reset();
      }
    };
  }, [onDetect]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative w-full max-w-sm">
        {error ? (
          <div className="rounded-lg bg-[var(--surface)] p-6 text-center space-y-3">
            <p className="text-body-sm text-[var(--danger)]">{error}</p>
            <Button onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="w-full rounded-lg" autoPlay muted playsInline />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="h-32 w-64 border-2 border-[var(--accent)] rounded-md" />
            </div>
          </>
        )}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center min-h-[auto] min-w-[auto]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
