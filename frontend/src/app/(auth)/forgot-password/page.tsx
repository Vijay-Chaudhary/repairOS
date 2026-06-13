'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Wrench } from 'lucide-react';
import { authApi } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const LAST_TENANT_KEY = 'repaiross_last_tenant';

// ── Step schemas ───────────────────────────────────────────────────────────────

const step1Schema = z.object({
  workspace: z.string().min(1, 'Workspace ID is required'),
  phone: z.string().min(10, 'Enter a valid phone number'),
});

const step2Schema = z.object({
  otp: z.string().length(6, 'Enter the 6-digit code'),
});

const step3Schema = z.object({
  new_password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Must include an uppercase letter')
    .regex(/\d/, 'Must include a number')
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/, 'Must include a special character'),
  confirm_password: z.string(),
}).refine((d) => d.new_password === d.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
});

type Step1Values = z.infer<typeof step1Schema>;
type Step2Values = z.infer<typeof step2Schema>;
type Step3Values = z.infer<typeof step3Schema>;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 'done'>(1);
  const [error, setError] = useState<string | null>(null);

  // State carried across steps
  const [workspace, setWorkspace] = useState(
    typeof window !== 'undefined' ? (localStorage.getItem(LAST_TENANT_KEY) ?? '') : ''
  );
  const [phone, setPhone] = useState('');
  const [accessToken, setAccessToken] = useState('');

  // ── Step 1 form ─────────────────────────────────────────────────────────────
  const form1 = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: { workspace, phone: '' },
  });

  async function onStep1(values: Step1Values) {
    setError(null);
    try {
      await authApi.otpRequestWithTenant({ phone: values.phone }, values.workspace.trim().toLowerCase());
      setWorkspace(values.workspace.trim().toLowerCase());
      setPhone(values.phone);
      setStep(2);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'NOT_FOUND' || e.code === 'TENANT_DB_UNAVAILABLE') {
          setError('Workspace not found. Check your workspace ID.');
        } else {
          setError(e.message || 'Could not send OTP. Please try again.');
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
    }
  }

  // ── Step 2 form ─────────────────────────────────────────────────────────────
  const form2 = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
    defaultValues: { otp: '' },
  });

  async function onStep2(values: Step2Values) {
    setError(null);
    try {
      const res = await authApi.otpVerifyWithTenant({ phone, otp: values.otp }, workspace);
      setAccessToken(res.access);
      setStep(3);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message || 'Invalid or expired OTP.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    }
  }

  // ── Step 3 form ─────────────────────────────────────────────────────────────
  const form3 = useForm<Step3Values>({
    resolver: zodResolver(step3Schema),
    defaultValues: { new_password: '', confirm_password: '' },
  });

  async function onStep3(values: Step3Values) {
    setError(null);
    try {
      await authApi.resetPassword({ new_password: values.new_password }, accessToken);
      setStep('done');
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message || 'Could not reset password. Please start over.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-sm mx-auto space-y-7">
      {/* Mobile logo */}
      <div className="lg:hidden flex items-center gap-2.5 mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
          <Wrench className="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        <span className="font-semibold text-[var(--text)]">RepairOS</span>
      </div>

      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-[var(--text)]">
          {step === 'done' ? 'Password reset' : 'Forgot password'}
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          {step === 1 && 'Enter your workspace and phone number to receive a verification code.'}
          {step === 2 && `Enter the 6-digit code sent to ${phone}.`}
          {step === 3 && 'Choose a new password for your account.'}
          {step === 'done' && 'Your password has been updated. You can now sign in.'}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl bg-[var(--danger)]/10 border border-[var(--danger)]/25 px-4 py-3 text-sm text-[var(--danger)]">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} />
          <span>{error}</span>
        </div>
      )}

      {/* Step 1 — workspace + phone */}
      {step === 1 && (
        <Form {...form1}>
          <form onSubmit={form1.handleSubmit(onStep1)} className="space-y-4">
            <FormField control={form1.control} name="workspace" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-[var(--text)]">Workspace ID</FormLabel>
                <FormControl>
                  <Input autoComplete="organization" placeholder="your_shop_name" className="h-11" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form1.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-[var(--text)]">Registered phone number</FormLabel>
                <FormControl>
                  <Input type="tel" autoComplete="tel" placeholder="+91XXXXXXXXXX" className="h-11" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full h-11 font-semibold text-sm" disabled={form1.formState.isSubmitting}>
              {form1.formState.isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending…
                </span>
              ) : 'Send verification code'}
            </Button>
          </form>
        </Form>
      )}

      {/* Step 2 — OTP */}
      {step === 2 && (
        <Form {...form2}>
          <form onSubmit={form2.handleSubmit(onStep2)} className="space-y-4">
            <FormField control={form2.control} name="otp" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-[var(--text)]">Verification code</FormLabel>
                <FormControl>
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={6}
                    className="h-11 tracking-widest text-center text-lg font-mono"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full h-11 font-semibold text-sm" disabled={form2.formState.isSubmitting}>
              {form2.formState.isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verifying…
                </span>
              ) : 'Verify code'}
            </Button>
            <button
              type="button"
              className="w-full text-sm text-[var(--accent)] hover:underline"
              onClick={() => { setError(null); setStep(1); }}
            >
              ← Change phone number
            </button>
          </form>
        </Form>
      )}

      {/* Step 3 — new password */}
      {step === 3 && (
        <Form {...form3}>
          <form onSubmit={form3.handleSubmit(onStep3)} className="space-y-4">
            <FormField control={form3.control} name="new_password" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-[var(--text)]">New password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" className="h-11" {...field} />
                </FormControl>
                <p className="text-xs text-[var(--text-muted)]">Min 8 chars · uppercase · number · special character</p>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form3.control} name="confirm_password" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-[var(--text)]">Confirm password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" className="h-11" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full h-11 font-semibold text-sm" disabled={form3.formState.isSubmitting}>
              {form3.formState.isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Resetting…
                </span>
              ) : 'Reset password'}
            </Button>
          </form>
        </Form>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-[var(--success)]/10 border border-[var(--success)]/30 px-4 py-4">
            <CheckCircle2 className="w-5 h-5 text-[var(--success)] shrink-0" strokeWidth={2} />
            <p className="text-sm font-medium text-[var(--success)]">Password reset successfully</p>
          </div>
          <Button
            className="w-full h-11 font-semibold text-sm"
            onClick={() => router.replace(`/login?tenant=${workspace}`)}
          >
            Sign in now
          </Button>
        </div>
      )}

      {step !== 'done' && (
        <p className="text-center text-sm text-[var(--text-muted)]">
          Remember your password?{' '}
          <Link href="/login" className="font-semibold text-[var(--accent)] hover:underline">
            Sign in
          </Link>
        </p>
      )}
    </div>
  );
}
