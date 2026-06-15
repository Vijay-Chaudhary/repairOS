'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Search, UserX, LogOut, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PaginationBar } from '@/components/shared/PaginationBar';
import { ForbiddenPage } from '@/components/shared/ForbiddenPage';
import { settingsApi, type TenantUser } from '@/lib/api/settings';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/authStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const inviteSchema = z.object({
  full_name: z.string().min(2, 'Required'),
  email:     z.string().email('Invalid email'),
  phone:     z.string().regex(/^\+91[0-9]{10}$/, '+91XXXXXXXXXX'),
});
type InviteForm = z.infer<typeof inviteSchema>;

export default function UsersPage() {
  const { hasPermission } = useAuthStore();
  if (!hasPermission('settings.users.manage')) return <ForbiddenPage />;
  return <UsersInner />;
}

function UsersInner() {
  const qc = useQueryClient();
  const { user: me } = useAuthStore();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRoleIds, setInviteRoleIds] = useState<string[]>([]);
  const [deactivateTarget, setDeactivateTarget] = useState<TenantUser | null>(null);
  const [forceLogoutTarget, setForceLogoutTarget] = useState<TenantUser | null>(null);

  const debouncedSearch = useDebounce(search, 350);
  useEffect(() => { setListPage(1); }, [debouncedSearch, showInactive]);

  const filters = {
    search: debouncedSearch || undefined,
    is_active: showInactive ? undefined : true,
    page: listPage,
  };

  const { data, isLoading } = useQuery({
    queryKey: qk.users(filters),
    queryFn: () => settingsApi.listUsers(filters),
    staleTime: 30_000,
  });

  const { data: rolesData } = useQuery({
    queryKey: qk.roles(),
    queryFn: () => settingsApi.listRoles(),
    staleTime: 300_000,
  });
  const roles = rolesData?.items ?? [];

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { full_name: '', email: '', phone: '+91' },
  });

  const inviteMutation = useMutation({
    mutationFn: (v: InviteForm) => settingsApi.inviteUser({ ...v, role_ids: inviteRoleIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users() });
      toast.success('Invitation sent');
      form.reset({ full_name: '', email: '', phone: '+91' });
      setInviteRoleIds([]);
      setInviteOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const toggleInviteRole = (roleId: string, checked: boolean) => {
    setInviteRoleIds((prev) => checked ? [...prev, roleId] : prev.filter((id) => id !== roleId));
  };

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => settingsApi.updateUser(id, { is_active: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users() });
      toast.success('User deactivated');
      setDeactivateTarget(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const forceLogoutMutation = useMutation({
    mutationFn: (id: string) => settingsApi.forceLogout(id),
    onSuccess: () => {
      toast.success('All sessions revoked');
      setForceLogoutTarget(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const users = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3 shrink-0">
        <h1 className="text-h1 text-[var(--text)]">Users</h1>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Invite user</span>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)] shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            className="pl-9 h-9 w-[220px]"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-body-sm cursor-pointer">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Show inactive
        </label>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {isLoading ? (
          <div className="space-y-2">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : users.length === 0 ? (
          <p className="text-body-sm text-[var(--text-muted)] py-12 text-center">No users found.</p>
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left">
                  <th className="px-4 py-3 font-medium text-[var(--text-muted)]">User</th>
                  <th className="px-4 py-3 font-medium text-[var(--text-muted)]">Roles</th>
                  <th className="px-4 py-3 font-medium text-[var(--text-muted)]">Status</th>
                  <th className="px-4 py-3 font-medium text-[var(--text-muted)]">Last login</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--text)]">{u.full_name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.role_names.length > 0 ? u.role_names.map((r) => (
                          <span key={r} className="text-xs px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-muted)]">
                            {r}
                          </span>
                        )) : <span className="text-xs text-[var(--text-muted)]">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs font-medium', u.is_active ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {u.last_login ? formatDate(u.last_login) : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      {u.id !== me?.id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-[var(--warning)]"
                              onClick={() => setForceLogoutTarget(u)}
                            >
                              <LogOut className="h-4 w-4 mr-2" /> Force logout
                            </DropdownMenuItem>
                            {u.is_active && (
                              <DropdownMenuItem
                                className="text-[var(--danger)]"
                                onClick={() => setDeactivateTarget(u)}
                              >
                                <UserX className="h-4 w-4 mr-2" /> Deactivate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.meta?.total_pages !== undefined && data.meta.total_pages > 1 && (
              <div className="border-t border-[var(--border)] p-3">
                <PaginationBar
                  page={listPage}
                  totalPages={data.meta.total_pages}
                  totalCount={data.meta.count}
                  loading={isLoading}
                  onPageChange={setListPage}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Invite user</DialogTitle></DialogHeader>
          <p className="text-body-sm text-[var(--text-muted)]">
            They&apos;ll receive an email with login instructions.
          </p>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => inviteMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="full_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name *</FormLabel>
                  <FormControl><Input placeholder="Ravi Kumar" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email *</FormLabel>
                  <FormControl><Input type="email" placeholder="ravi@example.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone *</FormLabel>
                  <FormControl><Input placeholder="+91XXXXXXXXXX" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {roles.length > 0 && (
                <div>
                  <p className="text-body-sm font-medium text-[var(--text)] mb-2">Roles</p>
                  <div className="space-y-2 max-h-40 overflow-auto">
                    {roles.map((r) => (
                      <label key={r.id} className="flex items-center gap-2 text-body-sm cursor-pointer">
                        <Checkbox
                          checked={inviteRoleIds.includes(r.id)}
                          onCheckedChange={(v) => toggleInviteRole(r.id, v === true)}
                        />
                        {r.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => { setInviteRoleIds([]); setInviteOpen(false); }}>Cancel</Button>
                <Button type="submit" className="flex-1" disabled={inviteMutation.isPending}>
                  {inviteMutation.isPending ? 'Inviting…' : 'Send invite'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(v) => { if (!v) setDeactivateTarget(null); }}
        title={`Deactivate ${deactivateTarget?.full_name}?`}
        description="They will no longer be able to log in. This can be reversed."
        confirmLabel="Deactivate"
        loading={deactivateMutation.isPending}
        onConfirm={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
      />
      <ConfirmDialog
        open={!!forceLogoutTarget}
        onOpenChange={(v) => { if (!v) setForceLogoutTarget(null); }}
        title={`Force logout ${forceLogoutTarget?.full_name}?`}
        description="All active sessions will be immediately invalidated."
        confirmLabel="Revoke sessions"
        loading={forceLogoutMutation.isPending}
        onConfirm={() => forceLogoutTarget && forceLogoutMutation.mutate(forceLogoutTarget.id)}
      />
    </div>
  );
}
