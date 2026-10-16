import { BaseError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { buildDiscoveryFacts, DiscoveryFacts } from '../domain/discovery-facts';
import { BranchesRepository, getBranchesRepository } from '../repositories/branches.repository';
import {
  CapabilitiesRepository,
  getCapabilitiesRepository,
} from '../repositories/capabilities.repository';
import {
  getServiceAreasRepository,
  ServiceAreasRepository,
} from '../repositories/service-areas.repository';
import { getVendorsRepository, VendorsRepository } from '../repositories/vendors.repository';

const logger = createChildLogger(
  createLogger({ service: 'vendor-service', redactPII: true }),
  { service: 'DiscoveryFactsService' },
);

export class DiscoveryFactsService {
  constructor(
    private readonly vendors: VendorsRepository = getVendorsRepository(),
    private readonly branches: BranchesRepository = getBranchesRepository(),
    private readonly areas: ServiceAreasRepository = getServiceAreasRepository(),
    private readonly capabilities: CapabilitiesRepository = getCapabilitiesRepository(),
  ) {}

  async get(vendorId: string): Promise<DiscoveryFacts> {
    const vendor = await this.vendors.getVendorById(vendorId);
    if (!vendor) {
      throw new BaseError(
        `Vendor not found: ${vendorId}`,
        404,
        'VENDOR_NOT_FOUND',
        undefined,
        { retryable: false },
      );
    }
    const [branches, areas, capabilities] = await Promise.all([
      this.branches.listBranches(vendorId),
      this.areas.listServiceAreas(vendorId),
      this.capabilities.getCapabilities(vendorId),
    ]);
    const facts = buildDiscoveryFacts({ vendor, branches, areas, capabilities });
    logger.info({
      event: 'discovery_facts_read',
      vendorId,
      branchCount: facts.branches.length,
      serviceCount: facts.services.length,
    });
    return facts;
  }
}

let service: DiscoveryFactsService | undefined;

export function getDiscoveryFactsService(): DiscoveryFactsService {
  if (!service) {
    service = new DiscoveryFactsService();
  }
  return service;
}
