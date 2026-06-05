'use client';

import { useState, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api/auth';
import { settingsApi } from '@/lib/api/settings';
import { useAuthStore } from '@/lib/stores/authStore';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { wsClient } from '@/lib/ws/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ApiError } from '@/lib/api/client';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Required'),
});

type FormValues = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenantSlug = searchParams.get('tenant') ?? '';
  const { setAccessToken, setUser } = useAuthStore();
  const { setShops } = useActiveShopStore();
  const [apiError, setApiError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: FormValues) {
    setApiError(null);
    setLockedUntil(null);
    try {
      const res = await authApi.login({ ...values, ...(tenantSlug ? { tenant_slug: tenantSlug } : {}) });
      setAccessToken(res.access);
      setUser(res.user);
      const shops = await settingsApi.listShops();
      setShops(shops);
      const shopId = useActiveShopStore.getState().activeShopId;
      wsClient.connect(shopId, res.user.id);
      if (res.user.is_platform_admin) {
        router.replace('/platform');
      } else {
        router.replace('/dashboard');
      }
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.code === 'ACCOUNT_LOCKED') {
          setLockedUntil('Your account is temporarily locked. Please try again later.');
        } else {
          setApiError('Email or password is incorrect.');
        }
      } else {
        setApiError('Something went wrong. Please try again.');
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Sign in to RepairOS</h1>
          <p className="mt-1 text-body-sm text-[var(--text-muted)]">
            Or{' '}
            <Link href="/otp" className="text-[var(--accent)] hover:underline">sign in with OTP</Link>
          </p>
        </div>

        {(apiError || lockedUntil) && (
          <div className="rounded-md bg-[var(--danger)]/10 border border-[var(--danger)]/30 p-3 text-body-sm text-[var(--danger)]">
            {apiError ?? lockedUntil}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" autoComplete="email" placeholder="you@example.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl><Input type="password" autoComplete="current-password" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Form>

        <p className="text-center text-body-sm text-[var(--text-muted)]">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-[var(--accent)] hover:underline">Start free trial</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
