import type { IncludedServiceDescription } from '../utils/types/catalog-domain.types';

export interface OfferingEntitlement {
  serviceId: string;
  quantity: number;
  name: string;
  durationMinutes: number;
  categoryId: string;
}

/** Stable slug from included service name when serviceKey is absent. */
export function slugifyIncludedServiceName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length > 0 ? slug : 'service';
}

export function deriveOfferingEntitlements(
  included: readonly IncludedServiceDescription[],
): OfferingEntitlement[] {
  const used = new Set<string>();
  return included.map((entry) => {
    const base = entry.serviceKey?.trim() || slugifyIncludedServiceName(entry.name);
    let serviceId = base;
    let suffix = 2;
    while (used.has(serviceId)) {
      serviceId = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(serviceId);
    return {
      serviceId,
      quantity: entry.visitsPerPeriod,
      name: entry.name,
      durationMinutes: entry.durationMinutes,
      categoryId: entry.categoryId,
    };
  });
}
