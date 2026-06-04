import { format, formatDistanceToNow, parseISO, isValid } from 'date-fns';

const IST_OFFSET = 330; // IST is UTC+5:30

function toIst(date: Date): Date {
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  return new Date(utc + IST_OFFSET * 60_000);
}

function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const d = parseISO(value);
  return isValid(d) ? d : new Date(value);
}

export function formatDate(value: string | Date): string {
  try {
    return format(toIst(parseDate(value)), 'dd MMM yyyy');
  } catch {
    return String(value);
  }
}

export function formatDatetime(value: string | Date): string {
  try {
    return format(toIst(parseDate(value)), 'dd MMM yyyy, hh:mm a');
  } catch {
    return String(value);
  }
}

export function formatRelative(value: string | Date): string {
  try {
    return formatDistanceToNow(parseDate(value), { addSuffix: true });
  } catch {
    return String(value);
  }
}

export function formatTime(value: string | Date): string {
  try {
    return format(toIst(parseDate(value)), 'hh:mm a');
  } catch {
    return String(value);
  }
}

// Shared month-name arrays — single source of truth used across modules.
export const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

// ISO date helpers for period pickers.
export function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function monthEnd(year: number, month: number): string {
  return new Date(year, month, 0).toISOString().split('T')[0];
}
