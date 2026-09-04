/** Money and time formatting. Everything money-shaped is agorot in, string out. */

export const AGOROT_PER_ILS = 100;

/** `12345` -> `"₪123.45"`, `10000` -> `"₪100"`. */
export function formatAgorot(agorot: number, options: { sign?: boolean } = {}): string {
  const negative = agorot < 0;
  const abs = Math.abs(agorot);
  const ils = abs / AGOROT_PER_ILS;
  const body = `₪${Number.isInteger(ils) ? ils.toFixed(0) : ils.toFixed(2)}`;

  if (options.sign) return `${negative ? '−' : '+'}${body}`;
  return negative ? `−${body}` : body;
}

/** Parses the pot field. Accepts "100", "100.5", "₪100" — returns agorot. */
export function parseIlsToAgorot(input: string): number | null {
  const cleaned = input.replace(/[₪,\s]/g, '');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;

  const agorot = Math.round(Number(cleaned) * AGOROT_PER_ILS);
  return Number.isSafeInteger(agorot) && agorot > 0 ? agorot : null;
}

/** "in 2h 15m" / "closed" — used for the join deadline countdown. */
export function formatCountdown(closeAt: string | null, now: number = Date.now()): string | null {
  if (!closeAt) return null;

  const remaining = new Date(closeAt).getTime() - now;
  if (Number.isNaN(remaining)) return null;
  if (remaining <= 0) return 'Closed';

  const minutes = Math.floor(remaining / 60_000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;

  if (days > 0) return `Closes in ${days}d ${hours}h`;
  if (hours > 0) return `Closes in ${hours}h ${mins}m`;
  if (minutes > 0) return `Closes in ${mins}m`;
  return 'Closes in <1m';
}

/** "3 for / 2 against" style summary. */
export function formatSplit(countA: number, countB: number, labelA: string, labelB: string): string {
  return `${countA} ${labelA} · ${countB} ${labelB}`;
}

/**
 * Percentage split by *headcount*, not money — this is a social app, the
 * interesting number is how many friends are on each side.
 * An empty bet renders as a flat 50/50.
 */
export function positionPercentages(countA: number, countB: number): { a: number; b: number } {
  const total = countA + countB;
  if (total === 0) return { a: 50, b: 50 };

  const a = Math.round((countA / total) * 100);
  return { a, b: 100 - a };
}

/** "2 Sep" / "2 Sep 2025" once we cross into another year. */
export function formatShortDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Two-letter monogram for the avatar bubbles. */
export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Digits-only phone entry -> E.164, defaulting to Israel. */
export function normalisePhone(input: string, defaultCountryCode = '+972'): string | null {
  const trimmed = input.trim().replace(/[\s()-]/g, '');

  if (trimmed.startsWith('+')) {
    return /^\+\d{8,15}$/.test(trimmed) ? trimmed : null;
  }

  const local = trimmed.replace(/^0+/, '');
  if (!/^\d{7,14}$/.test(local)) return null;

  return `${defaultCountryCode}${local}`;
}
