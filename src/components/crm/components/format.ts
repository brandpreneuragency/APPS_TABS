/** Shared formatting helpers for CRM UI components (no store/service imports). */

export function formatCurrency(value?: number, currency = 'USD'): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  const symbol = currency === 'USD' ? '$' : '';
  const compact =
    value >= 1000
      ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
      : new Intl.NumberFormat('en-US').format(value);
  return `${symbol}${compact}`;
}

export function formatPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDate(iso?: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', opts);
}

export function formatRelative(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric' });
}

export function fullName(firstName?: string, lastName?: string): string {
  return [firstName, lastName].filter(Boolean).join(' ') || '—';
}

/**
 * Compare two ISO timestamps for descending sort (newest first), treating a
 * missing timestamp as the oldest. Use as `arr.sort(byNewestFirst(x => x.lastActivityAt ?? x.createdAt))`.
 */
export function byNewestFirst(selector: (item: { createdAt: string; lastActivityAt?: string }) => string | undefined): (a: { createdAt: string; lastActivityAt?: string }, b: { createdAt: string; lastActivityAt?: string }) => number {
  return (a, b) => {
    const av = selector(a) ?? a.createdAt;
    const bv = selector(b) ?? b.createdAt;
    return av < bv ? 1 : av > bv ? -1 : 0;
  };
}
