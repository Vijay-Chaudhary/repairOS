'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Wrench, Users, ShoppingCart, MessageSquare, FileText, BarChart3,
  Menu, X, CheckCircle, ArrowRight, Zap, Shield, Globe,
} from 'lucide-react';

// ── Navbar ─────────────────────────────────────────────────────────────

function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-[var(--surface)]/95 backdrop-blur-sm border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16 gap-8">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0 min-h-[auto] min-w-[auto]">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-[var(--accent)]">
              <Wrench className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-semibold text-[var(--text)]">RepairOS</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 flex-1">
            <a href="#features" className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors min-h-[auto] min-w-[auto]">Features</a>
            <a href="#how-it-works" className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors min-h-[auto] min-w-[auto]">How it works</a>
            <a href="#modules" className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors min-h-[auto] min-w-[auto]">Modules</a>
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3 ml-auto">
            <Link
              href="/login"
              className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)] transition-colors px-3 py-2 min-h-[auto] min-w-[auto]"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 transition-colors min-h-[auto] min-w-[auto]"
            >
              Start free trial <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden ml-auto p-2 rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-2)] transition-colors min-h-[auto] min-w-[auto]"
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--surface)] px-4 py-4 space-y-3">
          <a href="#features" onClick={() => setOpen(false)} className="block text-sm text-[var(--text-muted)] py-2 min-h-[auto] min-w-[auto]">Features</a>
          <a href="#how-it-works" onClick={() => setOpen(false)} className="block text-sm text-[var(--text-muted)] py-2 min-h-[auto] min-w-[auto]">How it works</a>
          <a href="#modules" onClick={() => setOpen(false)} className="block text-sm text-[var(--text-muted)] py-2 min-h-[auto] min-w-[auto]">Modules</a>
          <div className="flex flex-col gap-2 pt-2 border-t border-[var(--border)]">
            <Link href="/login" className="text-sm font-medium text-[var(--text)] py-2 text-center border border-[var(--border)] rounded-md hover:bg-[var(--surface-2)] transition-colors min-h-[auto] min-w-[auto]">
              Sign in
            </Link>
            <Link href="/register" className="text-sm font-medium text-white py-2 text-center bg-[var(--accent)] rounded-md hover:bg-[var(--accent)]/90 transition-colors min-h-[auto] min-w-[auto]">
              Start free trial
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

// ── Hero mockup card ───────────────────────────────────────────────────

function HeroMockup() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 bg-[var(--accent)]/8 rounded-2xl blur-2xl" aria-hidden />
      <div className="relative rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-md overflow-hidden">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 mx-4 h-5 rounded-md bg-[var(--border)] flex items-center justify-center">
            <span className="text-[10px] text-[var(--text-muted)]">repairosapp.com/jobs</span>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text)]">Repair Jobs</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">12 open</span>
          </div>

          {[
            { id: '#1042', device: 'iPhone 15 Pro — Screen', customer: 'Rohan Mehta', status: 'In Progress', color: 'bg-amber-100 text-amber-700' },
            { id: '#1041', device: 'Samsung S24 — Battery', customer: 'Priya Sharma', status: 'Ready', color: 'bg-green-100 text-green-700' },
            { id: '#1040', device: 'MacBook Air — Charging', customer: 'Amit Verma', status: 'Open', color: 'bg-blue-100 text-blue-700' },
          ].map((job) => (
            <div key={job.id} className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{job.id}</span>
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${job.color}`}>{job.status}</span>
                </div>
                <p className="text-xs font-medium text-[var(--text)] mt-0.5 truncate">{job.device}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{job.customer}</p>
              </div>
              <div className="w-6 h-6 rounded-full bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                <span className="text-[8px] font-semibold text-[var(--accent)]">
                  {job.customer.split(' ').map((n) => n[0]).join('')}
                </span>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
            <div className="text-center">
              <p className="text-xs font-semibold text-[var(--text)]">₹24,500</p>
              <p className="text-[9px] text-[var(--text-muted)]">Today</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-semibold text-[var(--success)]">8</p>
              <p className="text-[9px] text-[var(--text-muted)]">Completed</p>
            </div>
            <div className="text-center">
              <p className="text-xs font-semibold text-[var(--text)]">3</p>
              <p className="text-[9px] text-[var(--text-muted)]">Pending</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Data ───────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Wrench,
    title: 'Repair Job Tracking',
    description: 'Kanban board for every job. Assign technicians, track status from intake to delivery, and never lose a device.',
  },
  {
    icon: Users,
    title: 'CRM & Lead Pipeline',
    description: 'Full customer history, lead management, and conversion tracking — all in one place.',
  },
  {
    icon: ShoppingCart,
    title: 'Point of Sale',
    description: 'Fast counter sales, quick billing, and inventory deduction. Works offline on any device.',
  },
  {
    icon: MessageSquare,
    title: 'WhatsApp Notifications',
    description: '31 built-in message templates — job ready alerts, payment reminders, AMC renewal notices.',
  },
  {
    icon: FileText,
    title: 'GST Billing',
    description: 'Generate GST-compliant invoices instantly. Track payments, manage outstanding dues, and simplify returns.',
  },
  {
    icon: BarChart3,
    title: 'Reports & Analytics',
    description: 'Revenue trends, technician performance, inventory turnover — data-driven decisions for your shop.',
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Register your shop',
    description: 'Sign up in minutes. Add your technicians, set up your inventory, and configure your shop profile.',
  },
  {
    number: '02',
    title: 'Take in jobs',
    description: 'Log repair jobs at the counter, assign techs, and keep customers updated automatically via WhatsApp.',
  },
  {
    number: '03',
    title: 'Get paid, stay GST-ready',
    description: 'Auto-generate invoices, record payments, and export reports — all compliant with Indian GST requirements.',
  },
];

const MODULES = [
  'Repair Jobs', 'CRM', 'Leads', 'Point of Sale', 'Inventory',
  'Purchase Orders', 'Billing', 'Payments', 'AMC Contracts',
  'HR & Staff', 'Commissions', 'Finance', 'Reports', 'Settings',
];

const PLATFORM_HIGHLIGHTS = [
  {
    icon: Zap,
    title: 'PWA — works offline',
    desc: 'Installed on any phone. Works even without internet and syncs when reconnected.',
  },
  {
    icon: Shield,
    title: 'Secure multi-tenant',
    desc: "Each shop's data is isolated. Role-based permissions for every team member.",
  },
  {
    icon: Globe,
    title: 'Made for India',
    desc: 'GST billing, Indian locale formatting, and WhatsApp — built in from day one.',
  },
];

// ── Page ───────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-[var(--accent)] focus:text-white focus:rounded-md focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      <Navbar />

      <main id="main">
        {/* Hero */}
        <section className="py-16 md:py-24 bg-[var(--bg)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              <div className="text-center lg:text-left">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/8 text-[var(--accent)] text-xs font-medium mb-6">
                  <Zap className="h-3.5 w-3.5" />
                  PWA · Mobile-first · Made for India
                </div>

                <h1 className="text-4xl sm:text-5xl font-bold text-[var(--text)] leading-tight tracking-tight">
                  Run your repair shop —<br />
                  <span className="text-[var(--accent)]">without the chaos.</span>
                </h1>

                <p className="mt-5 text-lg text-[var(--text-muted)] leading-relaxed max-w-lg mx-auto lg:mx-0">
                  Track jobs, manage customers, generate GST invoices, and send WhatsApp updates — all from one fast, mobile-first platform built for Indian repair shops.
                </p>

                <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                  <Link
                    href="/register"
                    className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-md bg-[var(--accent)] text-white text-sm font-semibold hover:bg-[var(--accent)]/90 transition-colors shadow-sm min-h-[auto] min-w-[auto]"
                  >
                    Start free trial <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/login"
                    className="inline-flex items-center justify-center h-12 px-6 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm font-semibold hover:bg-[var(--surface-2)] transition-colors min-h-[auto] min-w-[auto]"
                  >
                    Sign in
                  </Link>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-4 justify-center lg:justify-start">
                  {['No credit card required', 'Cancel anytime'].map((t) => (
                    <div key={t} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                      <CheckCircle className="h-3.5 w-3.5 text-[var(--success)]" />
                      {t}
                    </div>
                  ))}
                </div>
              </div>

              <div className="hidden lg:block">
                <HeroMockup />
              </div>
            </div>
          </div>
        </section>

        {/* Stats bar */}
        <div className="border-y border-[var(--border)] bg-[var(--surface-2)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
              {[
                { value: '100+', label: 'API endpoints' },
                { value: '31',   label: 'WhatsApp templates' },
                { value: 'Multi-branch', label: 'Ready' },
                { value: 'GST',  label: 'Compliant' },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="text-2xl font-bold text-[var(--text)]">{stat.value}</p>
                  <p className="text-sm text-[var(--text-muted)] mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Features */}
        <section id="features" className="py-20 bg-[var(--bg)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 className="text-3xl font-bold text-[var(--text)] tracking-tight">
                Everything your shop needs
              </h2>
              <p className="mt-3 text-base text-[var(--text-muted)] max-w-xl mx-auto">
                From the first repair intake to GST filing — RepairOS handles every workflow your team relies on.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface-2)] transition-colors"
                >
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--accent)]/10 mb-4">
                    <f.icon className="h-5 w-5 text-[var(--accent)]" />
                  </div>
                  <h3 className="text-base font-semibold text-[var(--text)] mb-2">{f.title}</h3>
                  <p className="text-sm text-[var(--text-muted)] leading-relaxed">{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="py-20 bg-[var(--surface)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 className="text-3xl font-bold text-[var(--text)] tracking-tight">
                Up and running in minutes
              </h2>
              <p className="mt-3 text-base text-[var(--text-muted)] max-w-xl mx-auto">
                No lengthy onboarding. No IT team required. Just sign up and start taking jobs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-10 relative">
              <div className="hidden md:block absolute top-8 left-[calc(33%+2rem)] right-[calc(33%+2rem)] h-px border-t-2 border-dashed border-[var(--border)]" aria-hidden />

              {STEPS.map((step) => (
                <div key={step.number} className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full border-2 border-[var(--accent)]/20 bg-[var(--accent)]/10 mb-5">
                    <span className="text-xl font-bold text-[var(--accent)]">{step.number}</span>
                  </div>
                  <h3 className="text-base font-semibold text-[var(--text)] mb-2">{step.title}</h3>
                  <p className="text-sm text-[var(--text-muted)] leading-relaxed max-w-xs mx-auto">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Modules */}
        <section id="modules" className="py-20 bg-[var(--bg)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-[var(--text)] tracking-tight">
                One platform. Every module.
              </h2>
              <p className="mt-3 text-base text-[var(--text-muted)] max-w-xl mx-auto">
                No patchwork of tools. RepairOS ships all the modules your shop will ever need — included by default.
              </p>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              {MODULES.map((mod) => (
                <div
                  key={mod}
                  className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] font-medium"
                >
                  <CheckCircle className="h-3.5 w-3.5 text-[var(--success)] shrink-0" />
                  {mod}
                </div>
              ))}
            </div>

            <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-6">
              {PLATFORM_HIGHLIGHTS.map((item) => (
                <div key={item.title} className="flex gap-4 p-5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                  <div className="shrink-0 w-9 h-9 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center">
                    <item.icon className="h-4 w-4 text-[var(--accent)]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text)] mb-1">{item.title}</h3>
                    <p className="text-sm text-[var(--text-muted)] leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA band */}
        <section className="bg-[var(--accent)] py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-bold text-white tracking-tight">
              Ready to modernize your repair shop?
            </h2>
            <p className="mt-3 text-base text-white/80 max-w-lg mx-auto">
              Join repair shops across India using RepairOS to save time, reduce errors, and grow their business.
            </p>
            <Link
              href="/register"
              className="mt-8 inline-flex items-center gap-2 h-12 px-8 rounded-md border-2 border-white text-white text-sm font-semibold hover:bg-white hover:text-[var(--accent)] transition-colors min-h-[auto] min-w-[auto]"
            >
              Start your free trial <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-[var(--surface)] border-t border-[var(--border)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--accent)]">
                    <Wrench className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="text-base font-semibold text-[var(--text)]">RepairOS</span>
                </div>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed max-w-xs">
                  Repair shop management — fast, mobile-first, built for India.
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">Product</h4>
                <ul className="space-y-2">
                  {[
                    { label: 'Features', href: '#features' },
                    { label: 'How it works', href: '#how-it-works' },
                    { label: 'Modules', href: '#modules' },
                    { label: 'Sign in', href: '/login' },
                    { label: 'Start free trial', href: '/register' },
                  ].map((l) => (
                    <li key={l.label}>
                      <a href={l.href} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors min-h-[auto] min-w-[auto]">
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">Company</h4>
                <ul className="space-y-2">
                  {[
                    { label: 'Privacy Policy',   href: '/privacy' },
                    { label: 'Terms of Service', href: '/terms' },
                    { label: 'Contact',          href: 'mailto:support@repairosapp.com' },
                  ].map(({ label, href }) => (
                    <li key={label}>
                      <a href={href} className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors min-h-[auto] min-w-[auto]">
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-10 pt-6 border-t border-[var(--border)] text-center">
              <p className="text-xs text-[var(--text-muted)]">
                © {new Date().getFullYear()} RepairOS. All rights reserved.
              </p>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
