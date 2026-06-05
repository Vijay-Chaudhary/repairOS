/**
 * Lead form validation tests.
 *
 * The CreateLeadDialog is a private function in (app)/leads/page.tsx and cannot
 * be imported directly. These tests validate the Zod schema it uses. The schema
 * here is a literal copy of `leadSchema` from page.tsx — if you change one,
 * update the other. A future refactor could export the schema to remove duplication.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const leadSchema = z.object({
  name: z.string().min(2, 'Name required'),
  phone: z.string().min(10, 'Valid phone required'),
  email: z.string().email().optional().or(z.literal('')),
  source: z.enum(['walk_in', 'whatsapp', 'referral', 'google', 'facebook', 'other']),
  device_type: z.string().optional(),
  notes: z.string().optional(),
});

type SafeResult = ReturnType<typeof leadSchema.safeParse>;

function fieldErrors(result: SafeResult): Record<string, string[]> {
  if (result.success) return {};
  return result.error.flatten().fieldErrors as Record<string, string[]>;
}

// ── Required fields ───────────────────────────────────────────────────────────

describe('leadSchema — required field validation', () => {
  it('rejects empty name', () => {
    const result = leadSchema.safeParse({ name: '', phone: '+919876543210', source: 'walk_in' });
    expect(result.success).toBe(false);
    expect(fieldErrors(result).name).toBeDefined();
  });

  it('rejects single-character name (min 2)', () => {
    const result = leadSchema.safeParse({ name: 'A', phone: '+919876543210', source: 'walk_in' });
    expect(result.success).toBe(false);
    expect(fieldErrors(result).name).toBeDefined();
  });

  it('rejects missing phone', () => {
    const result = leadSchema.safeParse({ name: 'Rahul', source: 'walk_in' });
    expect(result.success).toBe(false);
    expect(fieldErrors(result).phone).toBeDefined();
  });

  it('rejects short phone string (< 10 chars)', () => {
    const result = leadSchema.safeParse({ name: 'Rahul', phone: '+9198', source: 'walk_in' });
    expect(result.success).toBe(false);
    expect(fieldErrors(result).phone).toBeDefined();
  });

  it('rejects missing source', () => {
    const result = leadSchema.safeParse({ name: 'Rahul', phone: '+919876543210' });
    expect(result.success).toBe(false);
    expect(fieldErrors(result).source).toBeDefined();
  });

  it('rejects unknown source value', () => {
    const result = leadSchema.safeParse({ name: 'Rahul', phone: '+919876543210', source: 'telegram' });
    expect(result.success).toBe(false);
    expect(fieldErrors(result).source).toBeDefined();
  });
});

// ── Optional fields ───────────────────────────────────────────────────────────

describe('leadSchema — optional field validation', () => {
  it('accepts blank email (truly optional)', () => {
    const result = leadSchema.safeParse({
      name: 'Rahul', phone: '+919876543210', email: '', source: 'walk_in',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid email when provided', () => {
    const result = leadSchema.safeParse({
      name: 'Rahul', phone: '+919876543210', email: 'rahul@example.com', source: 'walk_in',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed email string', () => {
    const result = leadSchema.safeParse({
      name: 'Rahul', phone: '+919876543210', email: 'not-an-email', source: 'walk_in',
    });
    expect(result.success).toBe(false);
    expect(fieldErrors(result).email).toBeDefined();
  });

  it('accepts omitted device_type and notes', () => {
    const result = leadSchema.safeParse({
      name: 'Rahul Sharma', phone: '+919876543210', source: 'whatsapp',
    });
    expect(result.success).toBe(true);
  });
});

// ── Valid complete input ──────────────────────────────────────────────────────

describe('leadSchema — valid complete input', () => {
  it('accepts all fields correctly filled', () => {
    const result = leadSchema.safeParse({
      name: 'Rahul Sharma',
      phone: '+919876543210',
      email: 'rahul@example.com',
      source: 'whatsapp',
      device_type: 'iPhone 14 Pro',
      notes: 'Screen cracked on right corner',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all valid source values', () => {
    const sources = ['walk_in', 'whatsapp', 'referral', 'google', 'facebook', 'other'] as const;
    for (const source of sources) {
      const result = leadSchema.safeParse({ name: 'Test', phone: '+919876543210', source });
      expect(result.success).toBe(true);
    }
  });
});
