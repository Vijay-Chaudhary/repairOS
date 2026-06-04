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
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, hyphens only'),
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

type FormValues = z.infer<typeof schema>;

type ProvisionStatus = 'idle' | 'submitting' | 'provisioning' | 'active' | 'failed';

export default function RegisterPage() {
  const [status, setStatus] = useState<ProvisionStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { business_name: '', slug: '', owner_name: '', phone: '+91', email: '', password: '' },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    setStatus('submitting');
    try {
      await apiFetch('/register/', { method: 'POST', body: JSON.stringify(values), skipAuth: true });
      setStatus('provisioning');
      pollStatus(values.slug);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? 'Registration failed');
      setStatus('idle');
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
                <FormControl><Input placeholder="sunrise-repairs" {...field} /></FormControl>
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
              {form.formState.isSubmitting ? 'Creating…' : 'Create workspace'}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
