'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { authApi } from '@/lib/api/auth';
import { useAuthStore } from '@/lib/stores/authStore';
import { ApiError } from '@/lib/api/client';

const profileSchema = z.object({
  full_name: z.string().min(2, 'Required'),
  phone: z.string().regex(/^\+91[6-9]\d{9}$/, 'Use format +91XXXXXXXXXX'),
});

const passwordSchema = z.object({
  old_password: z.string().min(1, 'Required'),
  new_password: z.string()
    .min(8, 'Min 8 characters')
    .regex(/[A-Z]/, 'Needs an uppercase letter')
    .regex(/\d/, 'Needs a number')
    .regex(/[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?]/, 'Needs a special character'),
});

type ProfileForm  = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

export default function ProfilePage() {
  const { user, setUser } = useAuthStore();

  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema) });
  const passwordForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) });

  useEffect(() => {
    if (user) {
      profileForm.reset({ full_name: user.name, phone: user.phone });
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const profileMutation = useMutation({
    mutationFn: (v: ProfileForm) => authApi.updateMe({ full_name: v.full_name, phone: v.phone }),
    onSuccess: (updated) => {
      setUser(updated);
      toast.success('Profile saved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to save profile'),
  });

  const passwordMutation = useMutation({
    mutationFn: (v: PasswordForm) => authApi.changePassword(v),
    onSuccess: () => {
      passwordForm.reset();
      toast.success('Password changed');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to change password'),
  });

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-8 max-w-2xl mx-auto">
      <div>
        <h1 className="text-h1 text-[var(--text)]">My Profile</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
          Update your personal details and password.
        </p>
      </div>

      {/* Personal info */}
      <section>
        <h2 className="text-body font-semibold text-[var(--text)] mb-4">Personal info</h2>
        <Form {...profileForm}>
          <form onSubmit={profileForm.handleSubmit((v) => profileMutation.mutate(v))} className="space-y-4">
            <FormField control={profileForm.control} name="full_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Full name *</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormItem>
              <FormLabel>Email</FormLabel>
              <Input value={user?.email ?? ''} disabled readOnly />
            </FormItem>
            <FormField control={profileForm.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel>Phone *</FormLabel>
                <FormControl><Input placeholder="+91XXXXXXXXXX" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" disabled={profileMutation.isPending}>
              {profileMutation.isPending ? 'Saving…' : 'Save profile'}
            </Button>
          </form>
        </Form>
      </section>

      <hr className="border-[var(--border)]" />

      {/* Change password */}
      <section>
        <h2 className="text-body font-semibold text-[var(--text)] mb-4">Change password</h2>
        <Form {...passwordForm}>
          <form onSubmit={passwordForm.handleSubmit((v) => passwordMutation.mutate(v))} className="space-y-4">
            <FormField control={passwordForm.control} name="old_password" render={({ field }) => (
              <FormItem>
                <FormLabel>Current password *</FormLabel>
                <FormControl><Input type="password" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={passwordForm.control} name="new_password" render={({ field }) => (
              <FormItem>
                <FormLabel>New password *</FormLabel>
                <FormControl><Input type="password" {...field} /></FormControl>
                <FormMessage />
                <p className="text-xs text-[var(--text-muted)]">
                  Min 8 characters, include uppercase, number, and special character.
                </p>
              </FormItem>
            )} />
            <Button type="submit" disabled={passwordMutation.isPending}>
              {passwordMutation.isPending ? 'Updating…' : 'Change password'}
            </Button>
          </form>
        </Form>
      </section>
    </div>
  );
}
