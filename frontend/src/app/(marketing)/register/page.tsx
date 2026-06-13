'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import {
  Eye, EyeOff, AlertCircle, Wrench, CheckCircle2,
  Building2, AtSign, User, Phone, Mail, Lock, XCircle,
} from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel';

const schema = z.object({
  business_name: z.string().min(2, 'Required'),
  slug: z
    .string()
    .min(3, 'Min 3 characters')
    .max(50, 'Max 50 characters')
    .regex(/^[a-z0-9_]{3,50}$/, 'Lowercase letters, numbers, underscores only'),
  owner_name: z.string().min(2, 'Required'),
  phone: z.string().regex(/^\+91[0-9]{10}$/, 'Enter valid Indian mobile (+91XXXXXXXXXX)'),
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Min 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
});

type FormValues = z.infer<typeof schema>;

type ProvisionStatus = 'idle' | 'submitting' | 'verifying' | 'provisioning' | 'active' | 'failed';

interface InitResponse {
  slug: string;
  phone_masked: string;
  expires_in: number;
}

// ── Password strength ───────────────────────────────────────────────────────

function getStrength(password: string) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  if (!password) return { score: 0, label: '', color: '' };
  if (score <= 1) return { score, label: 'Weak', color: 'var(--danger)' };
  if (score === 2) return { score, label: 'Fair', color: 'var(--warning)' };
  if (score === 3) return { score, label: 'Good', color: 'var(--info)' };
  return { score, label: 'Strong', color: 'var(--success)' };
}

// ── 6-box OTP input ─────────────────────────────────────────────────────────

interface OtpBoxesProps {
  value: string;
  onChange: (v: string) => void;
  label: string;
}

function OtpBoxes({ value, onChange, label }: OtpBoxesProps) {
  const digits = value.padEnd(6, '').slice(0, 6).split('');
  const refs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null));

  const handleChange = useCallback(
    (i: number, raw: string) => {
      const cleaned = raw.replace(/\D/g, '').slice(-1);
      const next = digits.map((d, idx) => (idx === i ? cleaned : d)).join('').replace(/ /g, '');
      onChange(next);
      if (cleaned && i < 5) refs.current[i + 1]?.focus();
    },
    [digits, onChange],
  );

  const handleKeyDown = useCallback(
    (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !digits[i] && i > 0) {
        refs.current[i - 1]?.focus();
      }
      if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
      if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
    },
    [digits],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      onChange(pasted);
      const focusIdx = Math.min(pasted.length, 5);
      refs.current[focusIdx]?.focus();
    },
    [onChange],
  );

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-[var(--text)]">{label}</p>
      <div className="flex gap-2" onPaste={handlePaste}>
        {Array(6)
          .fill(null)
          .map((_, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digits[i] ?? ''}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              aria-label={`${label} digit ${i + 1}`}
              className="flex-1 h-12 text-center text-lg font-bold rounded-xl border bg-[var(--surface)] text-[var(--text)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)]"
              style={{
                borderColor: digits[i] && digits[i] !== ' ' ? 'var(--accent)' : 'var(--border)',
                minWidth: 0,
              }}
            />
          ))}
      </div>
    </div>
  );
}

// ── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ['Details', 'Verify', 'Done'];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
                style={{
                  background: done || active ? 'var(--accent)' : 'var(--surface-2)',
                  color: done || active ? 'var(--accent-fg)' : 'var(--text-muted)',
                }}
              >
                {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span
                className="text-xs font-medium"
                style={{ color: active ? 'var(--text)' : 'var(--text-muted)' }}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className="w-8 h-px"
                style={{ background: done ? 'var(--accent)' : 'var(--border)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Provisioning steps ───────────────────────────────────────────────────────

const PROVISION_STEPS = [
  'Creating your workspace',
  'Setting up database',
  'Configuring modules',
  'Finalizing setup',
];

function ProvisioningView({ done }: { done: boolean }) {
  const [reached, setReached] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (done) { setReached(PROVISION_STEPS.length); return; }
    const timers = PROVISION_STEPS.map((_, i) =>
      setTimeout(() => setReached(i + 1), (i + 1) * 7000),
    );
    return () => timers.forEach(clearTimeout);
  }, [done]);

  useEffect(() => {
    if (done) return;
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [done]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedLabel = mins > 0
    ? `${mins}m ${secs.toString().padStart(2, '0')}s`
    : `${secs}s`;

  return (
    <div className="w-full max-w-sm mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-[var(--text)]">
          {done ? 'Workspace ready!' : 'Setting up your workspace…'}
        </h1>
        {done ? (
          <p className="text-sm text-[var(--text-muted)]">Redirecting you to sign in…</p>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-[var(--text-muted)]">This usually takes under a minute.</p>
            <span
              className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full"
              style={{
                background: 'var(--surface-2)',
                color: elapsed > 60 ? 'var(--warning)' : 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
            >
              {elapsedLabel}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {PROVISION_STEPS.map((step, i) => {
          const isComplete = i < reached;
          const isActive = i === reached && !done;
          return (
            <div
              key={step}
              className="flex items-center gap-3 rounded-xl px-4 py-3 transition-all"
              style={{
                background: isComplete
                  ? 'var(--success)/8'
                  : isActive
                  ? 'var(--surface-2)'
                  : 'transparent',
                border: `1px solid ${isComplete ? 'transparent' : isActive ? 'var(--border)' : 'transparent'}`,
              }}
            >
              <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center">
                {isComplete || done ? (
                  <CheckCircle2
                    className="w-5 h-5"
                    style={{ color: 'var(--success)' }}
                    strokeWidth={2}
                  />
                ) : isActive ? (
                  <span
                    className="w-4 h-4 border-2 rounded-full animate-spin block"
                    style={{
                      borderColor: 'var(--border)',
                      borderTopColor: 'var(--accent)',
                    }}
                  />
                ) : (
                  <div
                    className="w-4 h-4 rounded-full border-2"
                    style={{ borderColor: 'var(--border)' }}
                  />
                )}
              </div>
              <span
                className="text-sm font-medium"
                style={{
                  color: isComplete || done
                    ? 'var(--success)'
                    : isActive
                    ? 'var(--text)'
                    : 'var(--text-muted)',
                }}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const [status, setStatus] = useState<ProvisionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState('');
  const [phoneMasked, setPhoneMasked] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phoneOtp, setPhoneOtp] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      business_name: '', slug: '', owner_name: '',
      phone: '+91', email: '', password: '',
    },
  });

  const businessName = form.watch('business_name');
  const password = form.watch('password');
  const strength = getStrength(password);

  // Auto-generate slug from business name until the user manually edits the field
  useEffect(() => {
    if (slugEdited) return;
    const auto = businessName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 50);
    form.setValue('slug', auto, { shouldValidate: true });
  }, [businessName, form, slugEdited]);

  async function onSubmit(values: FormValues) {
    setError(null);
    setStatus('submitting');
    try {
      const result = await apiFetch<InitResponse>('/register/', {
        method: 'POST',
        body: JSON.stringify(values),
        skipAuth: true,
      });
      setPendingSlug(result.slug);
      setPhoneMasked(result.phone_masked);
      setPendingEmail(values.email);
      setStatus('verifying');
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? 'Registration failed. Please try again.');
      setStatus('idle');
    }
  }

  async function onVerify() {
    if (phoneOtp.length !== 6 || emailCode.length !== 6) return;
    setError(null);
    setVerifyLoading(true);
    try {
      await apiFetch('/register/verify/', {
        method: 'POST',
        body: JSON.stringify({ slug: pendingSlug, phone_otp: phoneOtp, email_code: emailCode }),
        skipAuth: true,
      });
      setStatus('provisioning');
      pollStatus(pendingSlug);
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string };
      if (err.message?.includes('OTP_MAX_ATTEMPTS')) {
        setError('Too many failed attempts. Please start over.');
        setStatus('idle');
      } else {
        setError(err.message ?? 'Verification failed. Please check your codes.');
      }
    } finally {
      setVerifyLoading(false);
    }
  }

  async function pollStatus(slug: string) {
    // Poll for up to 3 minutes (60 × 3 s) — Celery startup latency can exceed 90 s
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await apiFetch<{ status: string }>(`/register/status/?slug=${slug}`, {
          skipAuth: true,
        });
        if (res.status === 'active') {
          setStatus('active');
          setTimeout(() => (window.location.href = '/login'), 3000);
          return;
        }
        if (res.status === 'failed') {
          setStatus('failed');
          return;
        }
      } catch {
        // continue polling
      }
    }
    setStatus('failed');
  }

  const stepIndex =
    status === 'idle' || status === 'submitting' ? 0
    : status === 'verifying' ? 1
    : 2;

  return (
    <div className="min-h-screen flex bg-[var(--surface)]">
      <AuthBrandPanel />

      <div className="flex-1 flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16 overflow-y-auto">

        {/* ── Failed ── */}
        {status === 'failed' && (
          <div className="w-full max-w-sm mx-auto space-y-6">
            <div className="flex flex-col items-center text-center space-y-3">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: 'var(--danger)/10' }}
              >
                <XCircle className="w-7 h-7" style={{ color: 'var(--danger)' }} strokeWidth={1.75} />
              </div>
              <h1 className="text-2xl font-bold text-[var(--text)]">Setup failed</h1>
              <p className="text-sm text-[var(--text-muted)]">
                We couldn&apos;t provision your workspace. Please try again.
              </p>
            </div>
            <Button className="w-full h-11" onClick={() => { setStatus('idle'); setError(null); }}>
              Try again
            </Button>
          </div>
        )}

        {/* ── Provisioning / Active ── */}
        {(status === 'provisioning' || status === 'active') && (
          <ProvisioningView done={status === 'active'} />
        )}

        {/* ── Verifying ── */}
        {status === 'verifying' && (
          <div className="w-full max-w-sm mx-auto space-y-7">
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                <Wrench className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-semibold text-[var(--text)]">RepairOS</span>
            </div>

            <StepIndicator current={stepIndex} />

            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-[var(--text)]">Verify your identity</h1>
              <p className="text-sm text-[var(--text-muted)]">
                We sent a 6-digit code to{' '}
                <span className="font-medium text-[var(--text)]">{phoneMasked}</span>{' '}
                and a separate code to{' '}
                <span className="font-medium text-[var(--text)]">{pendingEmail}</span>.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-[var(--danger)]/10 border border-[var(--danger)]/25 px-4 py-3 text-sm text-[var(--danger)]">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-5">
              <OtpBoxes label="Phone OTP" value={phoneOtp} onChange={setPhoneOtp} />
              <OtpBoxes label="Email verification code" value={emailCode} onChange={setEmailCode} />
            </div>

            <Button
              className="w-full h-11 font-semibold text-sm"
              onClick={onVerify}
              disabled={verifyLoading || phoneOtp.length !== 6 || emailCode.length !== 6}
            >
              {verifyLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verifying…
                </span>
              ) : (
                'Verify & create workspace'
              )}
            </Button>

            <button
              type="button"
              className="w-full text-sm text-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              style={{ minHeight: 0, minWidth: 0 }}
              onClick={() => { setStatus('idle'); setError(null); }}
            >
              Go back and edit details
            </button>
          </div>
        )}

        {/* ── Registration form ── */}
        {(status === 'idle' || status === 'submitting') && (
          <div className="w-full max-w-sm mx-auto space-y-6">
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                <Wrench className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-semibold text-[var(--text)]">RepairOS</span>
            </div>

            <StepIndicator current={stepIndex} />

            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-[var(--text)]">Start your free trial</h1>
              <p className="text-sm text-[var(--text-muted)]">
                Already have an account?{' '}
                <Link href="/login" className="font-medium text-[var(--accent)] hover:underline">
                  Sign in
                </Link>
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-[var(--danger)]/10 border border-[var(--danger)]/25 px-4 py-3 text-sm text-[var(--danger)]">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
                <span>{error}</span>
              </div>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                {/* Business name */}
                <FormField control={form.control} name="business_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-[var(--text)]">Business name</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" strokeWidth={2} />
                        <Input placeholder="Sunrise Repairs" className="h-11 pl-10" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Workspace URL */}
                <FormField control={form.control} name="slug" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-[var(--text)]">Workspace ID</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" strokeWidth={2} />
                        <Input
                          placeholder="sunrise_repairs"
                          className="h-11 pl-10"
                          {...field}
                          onChange={(e) => {
                            setSlugEdited(true);
                            field.onChange(e);
                          }}
                        />
                      </div>
                    </FormControl>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Lowercase letters, numbers, underscores only
                    </p>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Name + Phone row */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="owner_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-[var(--text)]">Your name</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" strokeWidth={2} />
                          <Input placeholder="Ravi Kumar" className="h-11 pl-10" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-[var(--text)]">Phone</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" strokeWidth={2} />
                          <Input inputMode="tel" placeholder="+91XXXXXXXXXX" className="h-11 pl-10" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Email */}
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-[var(--text)]">Email address</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" strokeWidth={2} />
                        <Input type="email" autoComplete="email" placeholder="you@company.com" className="h-11 pl-10" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Password */}
                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-[var(--text)]">Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" strokeWidth={2} />
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          className="h-11 pl-10 pr-10"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                          style={{ minHeight: 0, minWidth: 0 }}
                        >
                          {showPassword
                            ? <EyeOff className="w-4 h-4" strokeWidth={2} />
                            : <Eye className="w-4 h-4" strokeWidth={2} />}
                        </button>
                      </div>
                    </FormControl>
                    {/* Strength bar */}
                    {password && (
                      <div className="space-y-1 mt-1">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4].map((n) => (
                            <div
                              key={n}
                              className="flex-1 h-1 rounded-full transition-all duration-300"
                              style={{
                                background: n <= strength.score ? strength.color : 'var(--border)',
                              }}
                            />
                          ))}
                        </div>
                        <p className="text-xs" style={{ color: strength.color }}>
                          {strength.label}
                        </p>
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />

                <Button
                  type="submit"
                  className="w-full h-11 font-semibold text-sm"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending verification codes…
                    </span>
                  ) : (
                    'Continue'
                  )}
                </Button>
              </form>
            </Form>

            <p className="text-center text-xs text-[var(--text-muted)]">
              By continuing, you agree to our{' '}
              <Link href="/terms" className="text-[var(--accent)] hover:underline">Terms of Service</Link>
              {' '}and{' '}
              <Link href="/privacy" className="text-[var(--accent)] hover:underline">Privacy Policy</Link>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
