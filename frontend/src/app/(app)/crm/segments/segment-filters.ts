import { z } from 'zod';

// ── Segment filter rules schema ────────────────────────────────────────────────

export const segmentSchema = z.object({
  name: z.string().min(2, 'Name required'),
  description: z.string().optional(),
  is_dynamic: z.boolean(),
  // Filter rules fields
  tags: z.array(z.string()),
  min_total_billed: z.number().min(0),
  min_total_jobs: z.number().min(0),
  customer_type: z.enum(['individual', 'business', 'all']),
  city: z.string(),
});

export type SegmentFormValues = z.infer<typeof segmentSchema>;

export function buildFilterRules(values: SegmentFormValues): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  if (values.tags.length > 0) rules.tags = values.tags;
  if (values.min_total_billed > 0) rules.min_total_billed = values.min_total_billed;
  if (values.min_total_jobs > 0) rules.min_total_jobs = values.min_total_jobs;
  if (values.customer_type !== 'all') rules.customer_type = values.customer_type;
  if (values.city.trim()) rules.city = values.city.trim();
  return rules;
}

export function parseFilterRules(rules: Record<string, unknown>): Partial<SegmentFormValues> {
  return {
    tags: Array.isArray(rules.tags) ? (rules.tags as string[]) : [],
    min_total_billed: typeof rules.min_total_billed === 'number' ? rules.min_total_billed : 0,
    min_total_jobs: typeof rules.min_total_jobs === 'number' ? rules.min_total_jobs : 0,
    customer_type: (rules.customer_type as 'individual' | 'business') ?? 'all',
    city: typeof rules.city === 'string' ? rules.city : '',
  };
}
