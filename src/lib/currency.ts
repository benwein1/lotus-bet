/**
 * Money, in whichever currency the group keeps its books in.
 *
 * ---------------------------------------------------------------------------
 * The integers did not change, only what they denominate
 * ---------------------------------------------------------------------------
 * `total_pot_agorot` and `amount_agorot` are still integers of the currency's
 * **minor unit** — cents in a USD group, agorot in an ILS one. The columns kept
 * their names because renaming them would reach into `payout.ts`, which
 * CLAUDE.md §5 forbids touching casually, and the split maths is identical in
 * every currency: it never cared what the integers were counting.
 *
 * So there is no conversion anywhere in this file. A group is created with a
 * currency and keeps it forever, which is what lets `group_balances` keep
 * summing one column into one meaningful number.
 *
 * `formatAgorot` in `format.ts` is the ILS-only ancestor of this. It stays,
 * because a caller with no group in scope has nothing to pass here.
 */

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** The default for a new group. Existing groups are ILS — see the migration. */
export const DEFAULT_CURRENCY: Currency = 'USD';

interface CurrencyMeta {
  symbol: string;
  /** What the picker shows. */
  label: string;
  /** Minor units per major unit. All four are 100; named rather than assumed. */
  minor: number;
}

const META: Record<Currency, CurrencyMeta> = {
  USD: { symbol: '$', label: 'US dollar', minor: 100 },
  EUR: { symbol: '€', label: 'Euro', minor: 100 },
  GBP: { symbol: '£', label: 'British pound', minor: 100 },
  ILS: { symbol: '₪', label: 'Israeli shekel', minor: 100 },
};

/**
 * Anything unknown reads as the default rather than throwing.
 *
 * A row written by a newer client, or a group fetched before the column
 * existed, must not be able to crash a screen that only wanted to print a
 * number.
 */
export function asCurrency(value: string | null | undefined): Currency {
  const upper = (value ?? '').trim().toUpperCase();
  return (CURRENCIES as readonly string[]).includes(upper)
    ? (upper as Currency)
    : DEFAULT_CURRENCY;
}

export function currencySymbol(value: string | null | undefined): string {
  return META[asCurrency(value)].symbol;
}

export function currencyLabel(value: string | null | undefined): string {
  return META[asCurrency(value)].label;
}

/**
 * Minor units → a string with the symbol in front.
 *
 * Whole amounts lose their decimals, because "$40" is what somebody would say
 * out loud and "$40.00" is what a receipt says. The same rule `formatAgorot`
 * has always used.
 *
 * `Intl.NumberFormat` is deliberately not used: it would put the symbol where
 * the *device locale* wants it, so the same group's pot would read "$40" on one
 * phone and "40 $" on another. A bet is a shared object; the number has to look
 * the same to everybody in the group.
 */
export function formatMoney(
  minorUnits: number,
  currency: string | null | undefined,
  options: { sign?: boolean } = {}
): string {
  const code = asCurrency(currency);
  const negative = minorUnits < 0;
  const major = Math.abs(minorUnits) / META[code].minor;
  const body = `${META[code].symbol}${
    Number.isInteger(major) ? major.toFixed(0) : major.toFixed(2)
  }`;

  if (options.sign) return `${negative ? '−' : '+'}${body}`;
  return negative ? `−${body}` : body;
}

/**
 * What somebody typed → minor units, or null when it is not a usable amount.
 *
 * Strips the symbol of *any* supported currency, not just the active one:
 * people paste amounts, and "€40" typed into a dollar group should read as 40
 * rather than as nothing at all. The currency is the group's, never the
 * symbol's — that is the whole point of fixing it per group.
 */
export function parseMoneyToMinor(input: string, currency: string | null | undefined): number | null {
  const symbols = CURRENCIES.map((c) => META[c].symbol).join('');
  const cleaned = input.replace(new RegExp(`[${symbols},\\s]`, 'g'), '');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;

  const minor = Math.round(Number(cleaned) * META[asCurrency(currency)].minor);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}
