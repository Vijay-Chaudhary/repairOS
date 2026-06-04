'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Shield, Pencil, Trash2, Check, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ForbiddenPage } from '@/components/shared/ForbiddenPage';
import {
  settingsApi, PERMISSION_MODULE_LABELS, type Role, type Permission,
} from '@/lib/api/settings';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';

export default function RolesPage() {
  const { hasPermission } = useAuthStore();
  if (!hasPermission('settings.roles.manage')) return <ForbiddenPage />;
  return <RolesInner />;
}

function PermissionMatrix({
  permissions,
  selected,
  onChange,
}: {
  permissions: Permission[];
  selected: Set<string>;
  onChange: (id: string, checked: boolean) => void;
}) {
  const byModule = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    (acc[p.module] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      {Object.entries(byModule).map(([mod, perms]) => (
        <div key={mod}>
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
            {PERMISSION_MODULE_LABELS[mod] ?? mod}
          </p>
          <div className="space-y-1">
            {perms.map((p) => (
              <label key={p.id} className="flex items-start gap-2.5 cursor-pointer group">
                <div
                  onClick={() => onChange(p.id, !selected.has(p.id))}
                  className={cn(
                    'mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 cursor-pointer transition-colors',
                    selected.has(p.id)
                      ? 'bg-[var(--accent)] border-[var(--accent)]'
                      : 'border-[var(--border)] hover:border-[var(--accent)]',
                  )}
                >
                  {selected.has(p.id) && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
                <div className="min-w-0" onClick={() => onChange(p.id, !selected.has(p.id))}>
                  <p className="text-body-sm text-[var(--text)] leading-tight">{p.label}</p>
                  <p className="font-mono text-[10px] text-[var(--text-muted)]">{p.codename}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RolesInner() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Role | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  // Create form state
  const [roleName, setRoleName] = useState('');
  const [roleDesc, setRoleDesc] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());

  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: qk.roles(),
    queryFn: () => settingsApi.listRoles(),
    staleTime: 120_000,
  });

  const { data: permsData } = useQuery({
    queryKey: qk.permissions(),
    queryFn: () => settingsApi.listPermissions(),
    staleTime: 600_000,
  });

  const permissions = permsData?.items ?? [];
  const roles = rolesData?.items ?? [];

  function openCreate() {
    setRoleName(''); setRoleDesc(''); setSelectedPerms(new Set());
    setEditTarget(null);
    setCreateOpen(true);
  }

  function openEdit(role: Role) {
    setRoleName(role.name);
    setRoleDesc(role.description ?? '');
    setSelectedPerms(new Set(role.permission_ids));
    setEditTarget(role);
    setCreateOpen(true);
  }

  function togglePerm(id: string, checked: boolean) {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = { name: roleName, description: roleDesc || undefined, permission_ids: [...selectedPerms] };
      return editTarget
        ? settingsApi.updateRole(editTarget.id, body)
        : settingsApi.createRole(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.roles() });
      toast.success(editTarget ? 'Role updated' : 'Role created');
      setCreateOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteRole(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.roles() });
      toast.success('Role deleted');
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3 shrink-0">
        <h1 className="text-h1 text-[var(--text)]">Roles</h1>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New role</span>
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {rolesLoading ? (
          <div className="space-y-2">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : roles.length === 0 ? (
          <p className="text-body-sm text-[var(--text-muted)] py-12 text-center">No roles found.</p>
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
            {roles.map((role) => (
              <div key={role.id} className="flex items-start gap-3 p-4 bg-[var(--surface)] hover:bg-[var(--surface-2)]/40">
                <div className={cn(
                  'p-1.5 rounded-md shrink-0 mt-0.5',
                  role.is_system_role ? 'bg-[var(--accent)]/10' : 'bg-[var(--surface-2)]',
                )}>
                  {role.is_system_role
                    ? <Lock className="h-4 w-4 text-[var(--accent)]" />
                    : <Shield className="h-4 w-4 text-[var(--text-muted)]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-[var(--text)]">{role.name}</p>
                    {role.is_system_role && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                        System
                      </span>
                    )}
                  </div>
                  {role.description && (
                    <p className="text-body-sm text-[var(--text-muted)] mt-0.5">{role.description}</p>
                  )}
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {role.permission_codenames.length} permission{role.permission_codenames.length !== 1 ? 's' : ''}
                    {role.user_count != null ? ` · ${role.user_count} user${role.user_count !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>
                {!role.is_system_role && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(role)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-[var(--danger)] hover:bg-[var(--danger)]/10"
                      onClick={() => setDeleteTarget(role)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) setEditTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit role' : 'New role'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Role name *</label>
                <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="Custom Technician" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Description</label>
                <Input value={roleDesc} onChange={(e) => setRoleDesc(e.target.value)} placeholder="Optional description…" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-body-sm font-medium text-[var(--text)]">Permissions</p>
                <span className="text-xs text-[var(--text-muted)]">{selectedPerms.size} selected</span>
              </div>
              {permissions.length > 0 ? (
                <PermissionMatrix
                  permissions={permissions}
                  selected={selectedPerms}
                  onChange={togglePerm}
                />
              ) : (
                <p className="text-body-sm text-[var(--text-muted)]">Loading permissions…</p>
              )}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!roleName.trim() || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? 'Saving…' : editTarget ? 'Save changes' : 'Create role'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title={`Delete role "${deleteTarget?.name}"?`}
        description="Users with only this role will lose their permissions. This cannot be undone."
        confirmLabel="Delete role"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}
