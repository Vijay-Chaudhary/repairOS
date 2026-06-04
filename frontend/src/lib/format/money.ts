const formatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '₹0.00';
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n)) return '₹0.00';
  return formatter.format(n);
}

export function moneyCompact(amount: number): string {
  if (amount >= 1_00_000) return `₹${(amount / 1_00_000).toFixed(1)}L`;
  if (amount >= 1_000) return `₹${(amount / 1_000).toFixed(1)}K`;
  return money(amount);
}

export function parseMoneyInput(value: string): number {
  return parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
}
