'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { platformApi, type SubscriptionPlan } from '@/lib/api/platform';
import { ApiError } from '@/lib/api/client';
import { money } from '@/lib/format/money';
import { qk } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

const FEATURE_LABELS: Record<string, string> = {
  crm:              'CRM (leads, tasks, timeline)',
  segmentation:     'Customer segmentation',
  estimates:        'Repair estimates & approval',
  multi_stage:      'Multi-stage repair workflow',
  fault_templates:  'Fault templates / Warranty / Spare parts',
  pos:              'POS counter sale',
  pos_wholesale:    'POS wholesale',
  amc:              'AMC contracts',
  hr:               'HR / Petty cash / Assets / Budget',
  whatsapp:         'WhatsApp integration',
  tally_export:     'Tally CSV export',
  custom_roles:     'Custom roles',
  barcode:          'Barcode scanning',
  inter_shop:       'Inter-shop transfer',
  api_access:       'API access',
};

const FEATURE_KEYS = Object.keys(FEATURE_LABELS);

export default function PlansPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  // New plan form
  const [planName, setPlanName] = useState('');
  const [price, setPrice] = useState('');
  const [maxShops, setMaxShops] = useState('');
  const [maxUsers, setMaxUsers] = useState('');
  const [enabledFeatures, setEnabledFeatures] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: qk.plans(),
    queryFn: () => platformApi.listPlans(),
    staleTime: 300_000,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, enabledFeatures.has(k)]));
      return platformApi.createPlan({
        name: planName,
        price_monthly_inr: parseFloat(price) || 0,
        max_shops: maxShops ? parseInt(maxShops, 10) : null,
        max_users: maxUsers ? parseInt(maxUsers, 10) : null,
        max_products: null,
        max_jobs_per_month: null,
        features,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.plans() });
      toast.success('Plan created');
      setPlanName(''); setPrice(''); setMaxShops(''); setMaxUsers('');
      setEnabledFeatures(new Set());
      setCreateOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const plans = data?.items ?? [];

  function toggleFeature(key: string) {
    setEnabledFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Subscription Plans</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">Feature flags drive per-tenant capabilities.</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New plan
        </Button>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-3 gap-4">
          {[1,2,3].map((i) => <Skeleton key={i} className="h-96 rounded-xl" />)}
        </div>
      ) : plans.length === 0 ? (
        <p className="text-body-sm text-[var(--text-muted)] py-12 text-center">No plans configured yet.</p>
      ) : (
        <div className="grid md:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}

      {/* Create plan dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New subscription plan</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Plan name *</label>
                <Input placeholder="Professional" value={planName} onChange={(e) => setPlanName(e.target.value)} />
              </div>
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Price / month (₹) *</label>
                <Input type="number" placeholder="2999" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Max shops</label>
                <Input type="number" placeholder="∞" value={maxShops} onChange={(e) => setMaxShops(e.target.value)} />
              </div>
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Max users</label>
                <Input type="number" placeholder="∞" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} />
              </div>
            </div>

            <div>
              <p className="text-body-sm font-medium text-[var(--text)] mb-2">Features</p>
              <div className="space-y-1.5">
                {FEATURE_KEYS.map((k) => (
                  <label key={k} className="flex items-center gap-2 cursor-pointer group">
                    <div
                      onClick={() => toggleFeature(k)}
                      className={cn(
                        'h-4 w-4 rounded border flex items-center justify-center cursor-pointer transition-colors shrink-0',
                        enabledFeatures.has(k)
                          ? 'bg-[var(--accent)] border-[var(--accent)]'
                          : 'border-[var(--border)] hover:border-[var(--accent)]',
                      )}
                    >
                      {enabledFeatures.has(k) && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <span
                      className="text-body-sm text-[var(--text)] cursor-pointer"
                      onClick={() => toggleFeature(k)}
                    >
                      {FEATURE_LABELS[k]}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!planName || !price || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Creating…' : 'Create plan'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanCard({ plan }: { plan: SubscriptionPlan }) {
  const enabledFeatures = Object.entries(plan.features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-[var(--border)]">
        <h3 className="text-body font-semibold text-[var(--text)]">{plan.name}</h3>
        <p className="text-h1 font-bold text-[var(--text)] mt-1 tabular-nums">
          {money(plan.price_monthly_inr)}
          <span className="text-body-sm font-normal text-[var(--text-muted)]">/mo</span>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-muted)]">
          <span>Shops: {plan.max_shops ?? '∞'}</span>
          <span>Users: {plan.max_users ?? '∞'}</span>
          <span>Products: {plan.max_products ?? '∞'}</span>
          <span>Jobs/mo: {plan.max_jobs_per_month ?? '∞'}</span>
        </div>
      </div>
      <div className="px-5 py-4 flex-1">
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">Features</p>
        <ul className="space-y-1.5">
          {FEATURE_KEYS.map((k) => {
            const on = plan.features[k] ?? false;
            return (
              <li key={k} className={cn('flex items-center gap-2 text-xs', on ? 'text-[var(--text)]' : 'text-[var(--text-muted)] line-through opacity-50')}>
                <Check className={cn('h-3 w-3 shrink-0', on ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')} />
                {FEATURE_LABELS[k] ?? k}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="px-5 py-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
        {enabledFeatures.length} of {FEATURE_KEYS.length} features enabled
      </div>
    </div>
  );
}
