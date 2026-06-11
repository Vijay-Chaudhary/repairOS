'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { apiFetch } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const schema = z.object({
  business_name: z.string().min(2, 'Required'),
  slug: z.string().min(3, 'Min 3 characters').max(50, 'Max 50 characters').regex(/^[a-z0-9_]{3,50}$/, 'Lowercase letters, numbers, underscores only'),
  owner_name: z.string().min(2, 'Required'),
  phone: z.string().regex(/^\+91[0-9]{10}$/, 'Enter valid Indian mobile number'),
  email: z.string().email('Invalid email'),
  password: z
    .string()
    .min(8, 'Min 8 characters')
    .regex(/[A-Z]/, 'Need uppercase')
    .regex(/[0-9]/, 'Need number')
    .regex(/[^A-Za-z0-9]/, 'Need special character'),
});

const verifySchema = z.object({
  phone_otp: z.string().regex(/^[0-9]{6}$/, 'Enter 6-digit OTP'),
  email_code: z.string().regex(/^[0-9]{6}$/, 'Enter 6-digit code'),
});

type FormValues = z.infer<typeof schema>;
type VerifyValues = z.infer<typeof verifySchema>;

type ProvisionStatus = 'idle' | 'submitting' | 'verifying' | 'provisioning' | 'active' | 'failed';

interface InitResponse {
  slug: string;
  phone_masked: string;
  expires_in: number;
}

export default function RegisterPage() {
  const [status, setStatus] = useState<ProvisionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState('');
  const [phoneMasked, setPhoneMasked] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { business_name: '', slug: '', owner_name: '', phone: '+91', email: '', password: '' },
  });

  const verifyForm = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    defaultValues: { phone_otp: '', email_code: '' },
  });

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
      setError(err.message ?? 'Registration failed');
      setStatus('idle');
    }
  }

  async function onVerify(values: VerifyValues) {
    setError(null);
    try {
      await apiFetch('/register/verify/', {
        method: 'POST',
        body: JSON.stringify({
          slug: pendingSlug,
          phone_otp: values.phone_otp,
          email_code: values.email_code,
        }),
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
    }
  }

  async function pollStatus(slug: string) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await apiFetch<{ status: string }>(`/register/status/?slug=${slug}`, { skipAuth: true });
        if (res.status === 'active') {
          setStatus('active');
          setTimeout(() => (window.location.href = '/login'), 2000);
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

  if (status === 'provisioning' || status === 'active') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
        <div className="text-center space-y-4 max-w-sm">
          {status === 'active' ? (
            <>
              <div className="text-[var(--success)] text-4xl">✓</div>
              <h2 className="text-h1 text-[var(--text)]">Workspace ready!</h2>
              <p className="text-body-sm text-[var(--text-muted)]">Redirecting to login…</p>
            </>
          ) : (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-[var(--accent)] border-t-transparent mx-auto" />
              <h2 className="text-h1 text-[var(--text)]">Setting up your workspace…</h2>
              <p className="text-body-sm text-[var(--text-muted)]">This usually takes under a minute.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
        <div className="text-center space-y-4 max-w-sm">
          <h2 className="text-h1 text-[var(--danger)]">Setup failed</h2>
          <p className="text-body-sm text-[var(--text-muted)]">We couldn&apos;t set up your workspace. Please try again.</p>
          <Button onClick={() => setStatus('idle')}>Try again</Button>
        </div>
      </div>
    );
  }

  if (status === 'verifying') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h1 className="text-h1 text-[var(--text)]">Verify your identity</h1>
            <p className="mt-1 text-body-sm text-[var(--text-muted)]">
              We sent a 6-digit code to <strong>{phoneMasked}</strong> and a separate code to{' '}
              <strong>{pendingEmail}</strong>.
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-[var(--danger)]/10 border border-[var(--danger)]/30 p-3 text-body-sm text-[var(--danger)]">
              {error}
            </div>
          )}

          <Form {...verifyForm}>
            <form onSubmit={verifyForm.handleSubmit(onVerify)} className="space-y-4">
              <FormField control={verifyForm.control} name="phone_otp" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone OTP</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      autoComplete="one-time-code"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={verifyForm.control} name="email_code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email verification code</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="654321"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={verifyForm.formState.isSubmitting}>
                {verifyForm.formState.isSubmitting ? 'Verifying…' : 'Verify & create workspace'}
              </Button>
              <button
                type="button"
                className="w-full text-body-sm text-[var(--text-muted)] hover:underline"
                onClick={() => { setStatus('idle'); setError(null); }}
              >
                Go back and edit details
              </button>
            </form>
          </Form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Start your free trial</h1>
          <p className="mt-1 text-body-sm text-[var(--text-muted)]">
            Already have an account?{' '}
            <Link href="/login" className="text-[var(--accent)] hover:underline">Sign in</Link>
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-[var(--danger)]/10 border border-[var(--danger)]/30 p-3 text-body-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="business_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Business name</FormLabel>
                <FormControl><Input placeholder="Sunrise Repairs" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="slug" render={({ field }) => (
              <FormItem>
                <FormLabel>Workspace URL</FormLabel>
                <FormControl><Input placeholder="sunrise_repairs" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="owner_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Your name</FormLabel>
                <FormControl><Input placeholder="Ravi Kumar" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl><Input inputMode="tel" placeholder="+91XXXXXXXXXX" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" placeholder="you@example.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl><Input type="password" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Sending codes…' : 'Continue'}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
