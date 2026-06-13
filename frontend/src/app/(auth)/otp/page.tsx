'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Smartphone, Wrench } from 'lucide-react';
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
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null));
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  function startCountdown(seconds: number) {
    setCountdown(seconds);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
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
      setDigits(Array(6).fill(''));
      setStep('otp');
      // Focus first digit box after transition
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.code === 'OTP_RATE_LIMIT') {
          setError('Too many requests. Please wait before trying again.');
        } else {
          setError('Invalid phone number. Please check and try again.');
        }
      } else {
        setError('Failed to send OTP. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  const otp = digits.join('');

  async function verifyOtp() {
    setError(null);
    setLoading(true);
    try {
      const normalized = normalizePhone(phone);
      const res = await authApi.otpVerify({ phone: normalized, otp });
      setAccessToken(res.access);
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
          setError('Invalid OTP. Please check and try again.');
          setDigits(Array(6).fill(''));
          setTimeout(() => inputRefs.current[0]?.focus(), 50);
        }
      } else {
        setError('Verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      const cleaned = value.replace(/\D/g, '').slice(-1);
      const newDigits = [...digits];
      newDigits[index] = cleaned;
      setDigits(newDigits);
      if (cleaned && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [digits],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
      if (e.key === 'ArrowLeft' && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
      if (e.key === 'ArrowRight' && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [digits],
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newDigits = Array(6).fill('');
    pasted.split('').forEach((char, i) => { newDigits[i] = char; });
    setDigits(newDigits);
    const focusIndex = Math.min(pasted.length, 5);
    inputRefs.current[focusIndex]?.focus();
  }, []);

  return (
    <div className="w-full max-w-sm mx-auto space-y-7">
      {/* Mobile-only logo */}
      <div className="lg:hidden flex items-center gap-2.5 mb-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--accent)' }}
        >
          <Wrench className="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        <span className="font-semibold text-[var(--text)]">RepairOS</span>
      </div>

      {step === 'phone' ? (
        <>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-[var(--text)]">Sign in with OTP</h1>
            <p className="text-sm text-[var(--text-muted)]">
              We&apos;ll send a 6-digit code to your mobile number
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-[var(--danger)]/10 border border-[var(--danger)]/25 px-4 py-3 text-sm text-[var(--danger)]">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text)]">
                Mobile number
              </label>
              <div className="relative">
                <Smartphone
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none"
                  strokeWidth={2}
                />
                <Input
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && phone && requestOtp()}
                  className="h-11 pl-10"
                />
              </div>
            </div>

            <Button
              className="w-full h-11 font-semibold text-sm"
              onClick={requestOtp}
              disabled={loading || !phone.trim()}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending OTP…
                </span>
              ) : (
                'Send OTP'
              )}
            </Button>
          </div>

          <div className="relative flex items-center gap-3">
            <div className="flex-1 border-t border-[var(--border)]" />
            <span className="text-xs text-[var(--text-muted)]">or</span>
            <div className="flex-1 border-t border-[var(--border)]" />
          </div>

          <Button variant="outline" className="w-full h-11 font-medium text-sm" asChild>
            <Link href="/login">Use email &amp; password</Link>
          </Button>
        </>
      ) : (
        <>
          <div>
            <button
              onClick={() => { setStep('phone'); setError(null); }}
              className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors mb-6"
              style={{ minHeight: 0, minWidth: 0 }}
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={2} />
              Back
            </button>
            <h1 className="text-2xl font-bold text-[var(--text)]">Enter your code</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              6-digit code sent to{' '}
              <span className="font-medium text-[var(--text)]">{phone}</span>
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-[var(--danger)]/10 border border-[var(--danger)]/25 px-4 py-3 text-sm text-[var(--danger)]">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-5">
            {/* 6-box OTP input */}
            <div className="flex gap-2 justify-between" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  aria-label={`Digit ${i + 1}`}
                  className="flex-1 h-14 text-center text-xl font-bold rounded-xl border bg-[var(--surface)] text-[var(--text)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)]"
                  style={{
                    borderColor: digit ? 'var(--accent)' : 'var(--border)',
                    minWidth: 0,
                  }}
                />
              ))}
            </div>

            {countdown > 0 && (
              <p className="text-xs text-center text-[var(--text-muted)]">
                Code expires in{' '}
                <span className="font-semibold tabular-nums text-[var(--text)]">{countdown}s</span>
              </p>
            )}

            <Button
              className="w-full h-11 font-semibold text-sm"
              onClick={verifyOtp}
              disabled={loading || otp.length !== 6}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verifying…
                </span>
              ) : (
                'Verify & Sign in'
              )}
            </Button>

            <button
              onClick={requestOtp}
              disabled={loading || countdown > 0}
              className="w-full text-sm text-center text-[var(--accent)] hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              style={{ minHeight: 0, minWidth: 0 }}
            >
              {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
