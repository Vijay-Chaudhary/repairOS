import { Wrench, BarChart2, Users } from 'lucide-react';

const features = [
  {
    icon: Wrench,
    label: 'End-to-end repair tracking',
    sub: 'From intake to delivery in one place',
  },
  {
    icon: Users,
    label: 'Built-in CRM & AMC',
    sub: 'Retain customers, grow recurring revenue',
  },
  {
    icon: BarChart2,
    label: 'Real-time reports & GST billing',
    sub: 'Instant insights, fully compliant invoices',
  },
];

export function AuthBrandPanel() {
  return (
    <div
      className="hidden lg:flex lg:w-[56%] relative flex-col justify-between p-14 overflow-hidden"
      style={{
        background: 'linear-gradient(145deg, #0a0f17 0%, #111827 55%, #0d1f3c 100%)',
      }}
    >
      {/* Grid texture */}
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(77,139,240,1) 1px, transparent 1px), linear-gradient(90deg, rgba(77,139,240,1) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      {/* Glow — top right */}
      <div
        className="absolute top-[-120px] right-[-120px] w-[480px] h-[480px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(31,111,235,0.12) 0%, transparent 65%)',
        }}
      />
      {/* Glow — bottom left */}
      <div
        className="absolute bottom-[-80px] left-[-80px] w-[320px] h-[320px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(31,111,235,0.07) 0%, transparent 65%)',
        }}
      />

      {/* Logo */}
      <div className="relative z-10 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: '#1f6feb' }}
        >
          <Wrench className="w-[18px] h-[18px] text-white" strokeWidth={2.5} />
        </div>
        <span className="text-white text-xl font-semibold tracking-tight">RepairOS</span>
      </div>

      {/* Hero copy + features */}
      <div className="relative z-10 space-y-10">
        <div className="space-y-4">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.15em]"
            style={{ color: '#4d8bf0' }}
          >
            Trusted by 500+ repair shops
          </p>
          <h2 className="text-[2rem] font-bold leading-tight text-white">
            Complete repair shop<br />management, simplified.
          </h2>
          <p className="text-[0.9rem] leading-relaxed max-w-xs" style={{ color: '#8b98aa' }}>
            Run your front desk, workshop, billing, and customer relationships — all from one platform.
          </p>
        </div>

        <div className="space-y-5">
          {features.map(({ icon: Icon, label, sub }) => (
            <div key={label} className="flex items-start gap-4">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{
                  background: 'rgba(31,111,235,0.14)',
                  border: '1px solid rgba(31,111,235,0.28)',
                }}
              >
                <Icon className="w-[18px] h-[18px]" style={{ color: '#4d8bf0' }} strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white leading-snug">{label}</p>
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#8b98aa' }}>{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Testimonial */}
      <div
        className="relative z-10 rounded-2xl p-5"
        style={{
          background: 'rgba(255,255,255,0.035)',
          border: '1px solid rgba(255,255,255,0.07)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <p className="text-sm leading-relaxed italic" style={{ color: '#9aa4b2' }}>
          &ldquo;RepairOS cut our job processing time by 40% in the first month. The Kanban board alone paid for itself.&rdquo;
        </p>
        <div className="flex items-center gap-3 mt-4">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #1f6feb, #4d8bf0)' }}
          >
            RK
          </div>
          <div>
            <p className="text-xs font-semibold text-white">Rajesh Kumar</p>
            <p className="text-[11px]" style={{ color: '#5c6a7a' }}>iRepair Centre, Bangalore</p>
          </div>
        </div>
      </div>
    </div>
  );
}
