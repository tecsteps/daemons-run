// Adapted from old daemons-run (tag pre-pivot-2026-09-05) resources/js/lib/cloudCatalog.ts and lib/money.ts
export type Location = { name: string; city: string; country: string };
export type Size = {
  name: string;
  group: GroupId;
  cpus: number;
  cpuKind: 'shared' | 'dedicated';
  cpuVendor: string;
  architecture: 'x86' | 'arm';
  memoryGb: number;
  diskGb: number;
  prices: { location: string; hourly: string; monthly: string; trafficBytes: number | null }[];
  availableIn: string[];
};
export type Options = { locations: Location[]; sizes: Size[] };

export const groups = [
  { id: 'cost-optimized', label: 'Cost-Optimized', hint: 'Shared vCPUs, older hardware, x86 or Arm64' },
  { id: 'regular-performance', label: 'Regular Performance', hint: 'Shared vCPUs, newer AMD' },
  { id: 'general-purpose', label: 'General Purpose', hint: 'Dedicated vCPUs' },
] as const;
export type GroupId = (typeof groups)[number]['id'];

export const locationLabel = (l: Location) => `${l.city}, ${l.country} (${l.name})`;

export const priceAt = (size: Size, location: string) => size.prices.find((p) => p.location === location) ?? null;

export function disabledReason(size: Size, location: string): string | null {
  return size.availableIn.includes(location) ? null : `Not available in ${location}`;
}

export function sizesIn(sizes: Size[], group: GroupId, location: string): Size[] {
  return sizes
    .filter((s) => s.group === group)
    .sort((a, b) => Number(priceAt(a, location)?.monthly ?? Infinity) - Number(priceAt(b, location)?.monthly ?? Infinity));
}

export function trafficTb(size: Size, location: string): string {
  const bytes = priceAt(size, location)?.trafficBytes;
  return bytes ? `${Math.round(bytes / 1024 ** 4)} TB` : '—';
}

export const eur = (value: string | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `€${Number(value).toFixed(digits)}`;

export const perMonth = (value: string | null | undefined) => (value ? `${eur(value)}/month` : 'Price unavailable');

export const archLabel = (a: Size['architecture']) => (a === 'arm' ? 'Arm64' : 'x86');
