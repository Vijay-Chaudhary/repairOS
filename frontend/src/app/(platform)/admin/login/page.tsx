'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, AlertCircle, ShieldCheck } from 'lucide-react';
import { platformAuthApi } from '@/lib/api/platformAuth';
import { usePlatformAuthStore } from '@/lib/stores/platformAuthStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ApiError } from '@/lib/api/platformClient';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

export default function PlatformAdminLoginPage() {
  const router = useRouter();
  const { setAccessToken, setAdmin } = usePlatformAuthStore();
  const [apiError, setApiError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: FormValues) {
    setApiError(null);
    setLockedUntil(null);
    try {
      const res = await platformAuthApi.login(values);
      setAccessToken(res.access);
      setAdmin(res.admin);
      router.replace('/platform');
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.code === 'ACCOUNT_LOCKED') {
          setLockedUntil('This account is temporarily locked. Please try again later.');
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
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-sm mx-auto space-y-7">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
            <ShieldCheck className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-semibold text-[var(--text)]">RepairOS Platform Admin</span>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-[var(--text)]">Platform admin sign in</h1>
          <p className="text-sm text-[var(--text-muted)]">Independent of any tenant workspace</p>
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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-[var(--text)]">Email address</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" placeholder="you@repaiross.app" className="h-11" {...field} />
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
                  <FormLabel className="text-sm font-medium text-[var(--text)]">Password</FormLabel>
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
                        {showPassword ? <EyeOff className="w-4 h-4" strokeWidth={2} /> : <Eye className="w-4 h-4" strokeWidth={2} />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full h-11 font-semibold text-sm" disabled={form.formState.isSubmitting}>
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
      </div>
    </div>
  );
}
