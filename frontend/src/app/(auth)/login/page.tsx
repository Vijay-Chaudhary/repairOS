'use client';

import { useState, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, AlertCircle, Wrench } from 'lucide-react';
import { authApi } from '@/lib/api/auth';
import { settingsApi } from '@/lib/api/settings';
import { useAuthStore } from '@/lib/stores/authStore';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { wsClient } from '@/lib/ws/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ApiError } from '@/lib/api/client';

const LAST_TENANT_KEY = 'repaiross_last_tenant';

const schema = z.object({
  workspace: z.string().min(1, 'Workspace ID is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAccessToken, setUser } = useAuthStore();
  const { setShops } = useActiveShopStore();
  const [apiError, setApiError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Resolve workspace: URL param wins, then localStorage, then ''
  const urlTenant = searchParams.get('tenant') ?? '';
  const savedTenant = typeof window !== 'undefined'
    ? (localStorage.getItem(LAST_TENANT_KEY) ?? '')
    : '';
  const defaultWorkspace = urlTenant || savedTenant;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { workspace: defaultWorkspace, email: '', password: '' },
  });

  async function onSubmit(values: FormValues) {
    setApiError(null);
    setLockedUntil(null);
    const slug = values.workspace.trim().toLowerCase();
    try {
      const res = await authApi.login({ email: values.email, password: values.password }, slug);
      localStorage.setItem(LAST_TENANT_KEY, slug);
      setAccessToken(res.access);
      setUser(res.user);
      try {
        const shops = await settingsApi.listShops();
        setShops(shops);
        const shopId = useActiveShopStore.getState().activeShopId;
        wsClient.connect(shopId, res.user.id);
      } catch {
        // non-fatal — new tenant may have no shops yet
      }
      if (res.user.is_platform_admin) {
        router.replace('/platform');
      } else {
        router.replace('/dashboard');
      }
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.code === 'ACCOUNT_LOCKED') {
          setLockedUntil('Your account is temporarily locked. Please try again later.');
        } else if (e.code === 'NOT_FOUND' || e.code === 'TENANT_DB_UNAVAILABLE') {
          setApiError('Workspace not found. Check your workspace ID and try again.');
        } else {
          setApiError('Email or password is incorrect.');
        }
      } else {
        setApiError('Something went wrong. Please try again.');
      }
    }
  }

  const errorMessage = apiError ?? lockedUntil;

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

      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-[var(--text)]">Welcome back</h1>
        <p className="text-sm text-[var(--text-muted)]">Sign in to your workspace to continue</p>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2.5 rounded-xl bg-[var(--danger)]/10 border border-[var(--danger)]/25 px-4 py-3 text-sm text-[var(--danger)]">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" strokeWidth={2} />
          <span>{errorMessage}</span>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="workspace"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-[var(--text)]">
                  Workspace ID
                </FormLabel>
                <FormControl>
                  <Input
                    autoComplete="organization"
                    placeholder="your_shop_name"
                    className="h-11"
                    {...field}
                  />
                </FormControl>
                <p className="text-xs text-[var(--text-muted)]">
                  The ID you chose when registering (e.g. vijay_repairs)
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-[var(--text)]">
                  Email address
                </FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="h-11"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel className="text-sm font-medium text-[var(--text)]">
                    Password
                  </FormLabel>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-[var(--accent)] hover:underline"
                    tabIndex={-1}
                  >
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      className="h-11 pr-10"
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
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            className="w-full h-11 font-semibold text-sm"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in…
              </span>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>
      </Form>

      {/* Divider */}
      <div className="relative flex items-center gap-3">
        <div className="flex-1 border-t border-[var(--border)]" />
        <span className="text-xs text-[var(--text-muted)]">or continue with</span>
        <div className="flex-1 border-t border-[var(--border)]" />
      </div>

      <Button variant="outline" className="w-full h-11 font-medium text-sm" asChild>
        <Link href="/otp">Sign in with OTP</Link>
      </Button>

      <p className="text-center text-sm text-[var(--text-muted)]">
        New to RepairOS?{' '}
        <Link href="/register" className="font-semibold text-[var(--accent)] hover:underline">
          Start your free trial
        </Link>
      </p>
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
