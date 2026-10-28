import type { ServiceVisitSnapshot } from '@api-hub/event-platform';

export interface VisitProjection {
  vendorId: string;
  visitId: string;
  configurationVersion: number;
  status: ServiceVisitSnapshot['status'];
  name: string;
  deliveryModel: ServiceVisitSnapshot['deliveryModel'];
  location: ServiceVisitSnapshot['location'];
  timezone: string;
  windows: ServiceVisitSnapshot['windows'];
  serviceIds: string[];
  services: ServiceVisitSnapshot['services'];
  staffIds: string[];
  effectiveFrom: string;
  effectiveUntil?: string | null;
  occurredAt: string;
}

export type ProjectionDecision =
  | { applied: false; reason: 'stale' }
  | { applied: true; projection: VisitProjection };

/**
 * Last version wins. A replay or an older event does not move the projection backward.
 * Paused and archived visits stay in the projection so existing reservations remain addressable.
 */
export function applyVisitProjection(
  current: VisitProjection | null,
  incoming: ServiceVisitSnapshot,
): ProjectionDecision {
  if (current && incoming.configurationVersion <= current.configurationVersion) {
    return { applied: false, reason: 'stale' };
  }
  return {
    applied: true,
    projection: {
      vendorId: incoming.vendorId,
      visitId: incoming.visitId,
      configurationVersion: incoming.configurationVersion,
      status: incoming.status,
      name: incoming.name,
      deliveryModel: incoming.deliveryModel,
      location: incoming.location,
      timezone: incoming.timezone,
      windows: incoming.windows,
      serviceIds: incoming.serviceIds,
      services: incoming.services,
      staffIds: incoming.staffIds ?? [],
      effectiveFrom: incoming.effectiveFrom,
      effectiveUntil: incoming.effectiveUntil ?? null,
      occurredAt: incoming.occurredAt,
    },
  };
}
