'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api/auth';
import { useAuthStore } from '@/lib/stores/authStore';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { wsClient } from '@/lib/ws/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { normalizePhone } from '@/lib/format/phone';

type Step = 'phone' | 'otp';

export default function OtpPage() {
  const router = useRouter();
  const { setAccessToken, setUser } = useAuthStore();
  const { setActiveShop } = useActiveShopStore();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  function startCountdown(seconds: number) {
    setCountdown(seconds);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(countdownRef.current!); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  async function requestOtp() {
    setError(null);
    setLoading(true);
    try {
      const normalized = normalizePhone(phone);
      const res = await authApi.otpRequest({ phone: normalized });
      startCountdown(res.expires_in);
      setStep('otp');
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.code === 'OTP_RATE_LIMIT') {
          setError('Too many requests. Please wait before trying again.');
        } else {
          setError('Invalid phone number.');
        }
      } else {
        setError('Failed to send OTP.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    setLoading(true);
    try {
      const normalized = normalizePhone(phone);
      const res = await authApi.otpVerify({ phone: normalized, otp });
      setAccessToken(res.access_token);
      setUser(res.user);
      if (res.user.shop_ids[0]) setActiveShop(res.user.shop_ids[0]);
      wsClient.connect(res.user.shop_ids[0] ?? null, res.user.id);
      router.replace('/dashboard');
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.code === 'OTP_EXPIRED') {
          setError('OTP expired. Please request a new one.');
          setStep('phone');
        } else {
          setError('Invalid OTP. Please try again.');
        }
      } else {
        setError('Verification failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Sign in with OTP</h1>
          <p className="mt-1 text-body-sm text-[var(--text-muted)]">
            Or{' '}
            <Link href="/login" className="text-[var(--accent)] hover:underline">use email & password</Link>
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-[var(--danger)]/10 border border-[var(--danger)]/30 p-3 text-body-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        {step === 'phone' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-body-sm font-medium text-[var(--text)]">Mobile number</label>
              <Input
                inputMode="tel"
                placeholder="+91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <Button className="w-full" onClick={requestOtp} disabled={loading || !phone}>
              {loading ? 'Sending OTP…' : 'Send OTP'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-body-sm text-[var(--text-muted)]">
              Enter the 6-digit code sent to {phone}
            </p>
            <div className="space-y-2">
              <label className="text-body-sm font-medium text-[var(--text)]">OTP</label>
              <Input
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            {countdown > 0 && (
              <p className="text-body-sm text-[var(--text-muted)]">
                Code expires in {countdown}s
              </p>
            )}
            <Button className="w-full" onClick={verifyOtp} disabled={loading || otp.length !== 6}>
              {loading ? 'Verifying…' : 'Verify'}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => { setStep('phone'); setOtp(''); }}>
              Try different number
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
