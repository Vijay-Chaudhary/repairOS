'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, Check, Loader2, MessageSquare, Building, Palette, Users, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Stepper } from '@/components/shared/Stepper';
import { onboardingApi } from '@/lib/api/onboarding';
import { commissionsApi } from '@/lib/api/commissions';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const STEPS = [
  { label: 'Shop setup' },
  { label: 'Branding' },
  { label: 'Invite staff' },
  { label: 'Commissions' },
  { label: 'WhatsApp' },
];

const INDIA_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh',
];

function StepWrapper({ title, icon: Icon, children }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[var(--accent)]/10">
          <Icon className="h-5 w-5 text-[var(--accent)]" />
        </div>
        <h2 className="text-h2 text-[var(--text)] font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // Step 0 — Shop setup
  const [shopName, setShopName] = useState('');
  const [shopCode, setShopCode] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [gstin, setGstin] = useState('');
  const [shopPhone, setShopPhone] = useState('');
  const [shopId, setShopId] = useState('');

  // Step 1 — Branding
  const [logoUrl, setLogoUrl] = useState('');
  const [invoiceFooter, setInvoiceFooter] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');

  // Step 2 — Invite staff (optional)
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState('receptionist');

  // Step 3 — Commission rules
  const [commissionRate, setCommissionRate] = useState(30);
  const [leadShare, setLeadShare] = useState(50);

  // Step 4 — WhatsApp
  const [waPhone, setWaPhone] = useState('');

  async function handleStep0() {
    if (!shopName || !city || !state || !shopPhone) {
      toast.error('Please fill all required fields');
      return;
    }
    setLoading(true);
    try {
      const generated = shopName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'SHOP01';
      const shop = await onboardingApi.createShop({
        name: shopName,
        code: shopCode || generated,
        city, state, phone: shopPhone,
        gstin: gstin || undefined,
      });
      setShopId(shop.id);
      setStep(1);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create shop');
    } finally {
      setLoading(false);
    }
  }

  async function handleStep1() {
    setLoading(true);
    try {
      await onboardingApi.updateBranding({
        logo_url: logoUrl || undefined,
        invoice_footer: invoiceFooter || undefined,
        bank_name: bankName || undefined,
        bank_account_number: bankAccount || undefined,
        bank_ifsc: bankIfsc || undefined,
      });
      setStep(2);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save branding');
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2(skip?: boolean) {
    if (skip) { setStep(3); return; }
    if (!staffEmail) { toast.error('Enter an email address'); return; }
    setLoading(true);
    try {
      await onboardingApi.inviteStaff({ email: staffEmail, role_name: staffRole });
      toast.success('Invitation sent');
      setStep(3);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to invite staff');
    } finally {
      setLoading(false);
    }
  }

  async function handleStep3() {
    setLoading(true);
    try {
      await commissionsApi.createRule({
        name: 'Default commission rule',
        rate: commissionRate,
        lead_tech_share: leadShare,
        effective_from: new Date().toISOString().split('T')[0],
      });
      setStep(4);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save commission rules');
    } finally {
      setLoading(false);
    }
  }

  async function handleStep4(skip?: boolean) {
    if (!skip && waPhone) {
      setLoading(true);
      try {
        await onboardingApi.connectWhatsApp({ phone_number: waPhone });
        toast.success('WhatsApp connected');
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to connect WhatsApp');
        setLoading(false);
        return;
      } finally {
        setLoading(false);
      }
    }
    // If the user typed a number and then clicked Skip, make the discard explicit.
    if (skip && waPhone.trim()) {
      toast.info('WhatsApp number not saved — connect later in Settings → WhatsApp');
    }
    // Mark onboarding complete and go to dashboard
    try {
      await onboardingApi.completeOnboarding();
    } catch {
      // non-fatal
    }
    toast.success('Setup complete! Create your first job.');
    router.replace('/jobs/new');
  }

  void shopId; // used indirectly via shop creation

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col">
      {/* Header */}
      <header className="h-14 flex items-center px-6 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <span className="font-semibold text-[var(--text)]">RepairOS</span>
        <span className="ml-2 text-xs text-[var(--text-muted)]">— workspace setup</span>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-4 py-10">
        <div className="w-full max-w-lg space-y-8">
          {/* Progress stepper */}
          <Stepper steps={STEPS} currentStep={step} />

          {/* Step cards */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            {step === 0 && (
              <StepWrapper title="Set up your first shop" icon={Building}>
                <div className="space-y-3">
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Shop name *</label>
                    <Input
                      placeholder="Sunrise Repairs — Koramangala"
                      value={shopName}
                      onChange={(e) => {
                        setShopName(e.target.value);
                        if (!shopCode) setShopCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Shop code</label>
                      <Input
                        placeholder="AUTO"
                        maxLength={8}
                        className="font-mono uppercase"
                        value={shopCode}
                        onChange={(e) => setShopCode(e.target.value.toUpperCase())}
                      />
                    </div>
                    <div>
                      <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Phone *</label>
                      <Input placeholder="+91XXXXXXXXXX" value={shopPhone} onChange={(e) => setShopPhone(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-body-sm font-medium text-[var(--text)] block mb-1">City *</label>
                      <Input placeholder="Bengaluru" value={city} onChange={(e) => setCity(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-body-sm font-medium text-[var(--text)] block mb-1">State *</label>
                      <Select value={state} onValueChange={setState}>
                        <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          {INDIA_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">GSTIN</label>
                    <Input placeholder="22AAAAA0000A1Z5 (optional)" className="font-mono uppercase" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
                  </div>
                  <Button className="w-full" onClick={handleStep0} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Next <ArrowRight className="h-4 w-4" /></>}
                  </Button>
                </div>
              </StepWrapper>
            )}

            {step === 1 && (
              <StepWrapper title="Branding & bank details" icon={Palette}>
                <div className="space-y-3">
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Logo URL</label>
                    <Input placeholder="https://yourdomain.com/logo.png" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Invoice footer note</label>
                    <Input placeholder="Thank you for your business!" value={invoiceFooter} onChange={(e) => setInvoiceFooter(e.target.value)} />
                  </div>
                  <hr className="border-[var(--border)]" />
                  <p className="text-body-sm text-[var(--text-muted)]">Bank details appear on invoices for NEFT transfers.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Bank name</label>
                      <Input placeholder="HDFC Bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Account number</label>
                      <Input placeholder="XXXXXXXXXX" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-body-sm font-medium text-[var(--text)] block mb-1">IFSC code</label>
                      <Input placeholder="HDFC0001234" className="font-mono uppercase" value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} />
                    </div>
                  </div>
                  <Button className="w-full" onClick={handleStep1} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Next <ArrowRight className="h-4 w-4" /></>}
                  </Button>
                </div>
              </StepWrapper>
            )}

            {step === 2 && (
              <StepWrapper title="Invite your first staff member" icon={Users}>
                <div className="space-y-3">
                  <p className="text-body-sm text-[var(--text-muted)]">
                    They&apos;ll receive an email to set their password and log in.
                  </p>
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Staff email</label>
                    <Input type="email" placeholder="staff@example.com" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Role</label>
                    <Select value={staffRole} onValueChange={setStaffRole}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="receptionist">Receptionist</SelectItem>
                        <SelectItem value="technician">Technician</SelectItem>
                        <SelectItem value="shop_manager">Shop Manager</SelectItem>
                        <SelectItem value="billing_staff">Billing Staff</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => handleStep2(true)}>Skip for now</Button>
                    <Button className="flex-1" onClick={() => handleStep2()} disabled={loading}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Invite & next</>}
                    </Button>
                  </div>
                </div>
              </StepWrapper>
            )}

            {step === 3 && (
              <StepWrapper title="Commission defaults" icon={TrendingUp}>
                <div className="space-y-4">
                  <p className="text-body-sm text-[var(--text-muted)]">
                    These defaults apply to all repair jobs. You can add more specific rules later.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
                        Commission rate %
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={commissionRate}
                          onChange={(e) => setCommissionRate(Number(e.target.value))}
                          className="font-mono"
                        />
                        <span className="text-[var(--text-muted)] text-sm shrink-0">of SC</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
                        Lead tech share %
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={leadShare}
                          onChange={(e) => setLeadShare(Number(e.target.value))}
                          className="font-mono"
                        />
                        <span className="text-[var(--text-muted)] text-sm shrink-0">of commission</span>
                      </div>
                    </div>
                  </div>
                  <div className={cn(
                    'rounded-lg border p-3 text-body-sm',
                    'border-[var(--border)] bg-[var(--surface-2)]',
                  )}>
                    <p className="text-[var(--text-muted)]">
                      Example: ₹2,000 SC → ₹{(2000 * commissionRate / 100).toFixed(0)} commission →
                      lead tech gets ₹{(2000 * commissionRate / 100 * leadShare / 100).toFixed(0)}
                    </p>
                  </div>
                  <Button className="w-full" onClick={handleStep3} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Next <ArrowRight className="h-4 w-4" /></>}
                  </Button>
                </div>
              </StepWrapper>
            )}

            {step === 4 && (
              <StepWrapper title="Connect WhatsApp" icon={MessageSquare}>
                <div className="space-y-3">
                  <p className="text-body-sm text-[var(--text-muted)]">
                    RepairOS sends 31 notification templates via WhatsApp Business API —
                    job updates, invoices, payment reminders, and more.
                  </p>
                  <div>
                    <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
                      WhatsApp Business number
                    </label>
                    <Input
                      placeholder="+91XXXXXXXXXX"
                      value={waPhone}
                      onChange={(e) => setWaPhone(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => handleStep4(true)} disabled={loading}>
                      Skip for now
                    </Button>
                    <Button className="flex-1" onClick={() => handleStep4()} disabled={loading}>
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <><Check className="h-4 w-4" /> Connect & finish</>
                      )}
                    </Button>
                  </div>
                </div>
              </StepWrapper>
            )}
          </div>

          <p className="text-xs text-center text-[var(--text-muted)]">
            Step {step + 1} of {STEPS.length} — you can update these later in Settings
          </p>
        </div>
      </div>
    </div>
  );
}
