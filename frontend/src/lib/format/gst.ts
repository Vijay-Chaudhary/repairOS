import { money } from './money';

export interface GstBreakdownData {
  subtotal: number;
  gst_rate: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  total: number;
}

export function computeGstDisplay(
  base: number,
  ratePercent: number,
  isInterState: boolean
): GstBreakdownData {
  const gstAmount = (base * ratePercent) / 100;
  const halfGst = gstAmount / 2;
  return {
    subtotal: base,
    gst_rate: ratePercent,
    ...(isInterState
      ? { igst: gstAmount }
      : { cgst: halfGst, sgst: halfGst }),
    total: base + gstAmount,
  };
}

export function formatGstBreakdown(data: GstBreakdownData) {
  const lines: Array<{ label: string; amount: string }> = [
    { label: 'Subtotal', amount: money(data.subtotal) },
  ];
  if (data.igst !== undefined) {
    lines.push({ label: `IGST (${data.gst_rate}%)`, amount: money(data.igst) });
  } else {
    const halfRate = data.gst_rate / 2;
    lines.push(
      { label: `CGST (${halfRate}%)`, amount: money(data.cgst ?? 0) },
      { label: `SGST (${halfRate}%)`, amount: money(data.sgst ?? 0) }
    );
  }
  lines.push({ label: 'Total', amount: money(data.total) });
  return lines;
}
