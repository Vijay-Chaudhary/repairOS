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

// API money fields are DRF Decimals serialized as strings (e.g. "1234.56").
// Sum via integer paise to avoid both string concatenation bugs (typed `number`
// but actually a string at runtime) and floating-point drift on ₹ amounts.
export function sumMoney(...amounts: Array<number | string | null | undefined>): number {
  const paise = amounts.reduce<number>((total, amount) => {
    if (amount === null || amount === undefined) return total;
    const n = typeof amount === 'string' ? parseFloat(amount) : amount;
    return isNaN(n) ? total : total + Math.round(n * 100);
  }, 0);
  return paise / 100;
}
