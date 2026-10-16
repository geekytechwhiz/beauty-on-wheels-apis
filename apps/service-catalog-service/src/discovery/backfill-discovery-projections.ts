import { createChildLogger, createLogger } from '@api-hub/observability';

import {
  buildDiscoveryWritePlan,
  discoveryWriteBlocked,
  sameDiscoveryProjection,
} from '../domain/discovery-projection';
import { ServicesRepository } from '../repositories/services.repository';
import { ServiceDiscoveryEntity } from '../types/service-discovery.types';
import { ServiceEntity } from '../utils/types/catalog-domain.types';
import { persistDiscoveryFacts } from './persist-discovery-facts';
import {
  DiscoveryFactsSnapshot,
  DiscoveryFactsSource,
} from '../integrations/vendor-discovery-facts';

const logger = createChildLogger(
  createLogger({ service: 'service-catalog-service', redactPII: true }),
  { component: 'DiscoveryBackfill' },
);

const PAGE_SIZE = 25;

export interface BackfillDiscoveryOptions {
  vendorId: string;
  dryRun: boolean;
}

export interface BackfillDiscoveryReport {
  vendorId: string;
  dryRun: boolean;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

/**
 * Rebuilds discovery projections for one vendor. When the vendor facts
 * function is configured, approval, branches, coverage, and prices are read
 * from Vendor Service first. Does not write SERVICE items.
 */
export async function backfillDiscoveryProjections(
  repository: ServicesRepository,
  options: BackfillDiscoveryOptions,
  facts?: DiscoveryFactsSource | null,
): Promise<BackfillDiscoveryReport> {
  const report: BackfillDiscoveryReport = {
    vendorId: options.vendorId,
    dryRun: options.dryRun,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  let overlay: DiscoveryFactsSnapshot | null = null;
  if (facts) {
    overlay = await facts.load(options.vendorId);
    if (overlay && !options.dryRun) {
      await persistDiscoveryFacts(repository, overlay);
      overlay = null;
    }
  }

  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const page = await repository.listByVendor(options.vendorId, {
      limit: PAGE_SIZE,
      lastEvaluatedKey,
    });
    for (const service of page.items) {
      await backfillService(repository, service, options.dryRun, report, overlay);
    }
    lastEvaluatedKey = page.lastEvaluatedKey;
  } while (lastEvaluatedKey);

  logger.info({
    event: 'discovery_backfill_complete',
    vendorId: options.vendorId,
    dryRun: options.dryRun,
    processed: report.processed,
    created: report.created,
    updated: report.updated,
    skipped: report.skipped,
    failed: report.failed,
  });

  return report;
}

async function backfillService(
  repository: ServicesRepository,
  service: ServiceEntity,
  dryRun: boolean,
  report: BackfillDiscoveryReport,
  overlay: DiscoveryFactsSnapshot | null,
): Promise<void> {
  try {
    const plan = buildDiscoveryWritePlan({
      service,
      vendor: overlay?.vendor ?? await repository.getVendorDiscoveryState(service.vendorId),
      branches: overlay?.branches ?? await repository.listBranchDiscoveryStates(service.vendorId),
      price: overlay
        ? overlay.prices.find((price) => price.serviceId === service.serviceId) ?? null
        : await repository.getPriceDiscoveryState(service.vendorId, service.serviceId),
      existingPointers: await repository.listDiscoveryPointers(service.serviceId),
    });

    for (const item of plan.items) {
      report.processed += 1;
      try {
        const outcome = await classifyOrWrite(repository, item, dryRun);
        report[outcome] += 1;
      } catch (error) {
        report.failed += 1;
        logger.error({
          event: 'discovery_backfill_item_failed',
          vendorId: service.vendorId,
          serviceId: service.serviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (dryRun) {
      return;
    }

    for (const pointer of plan.pointers) {
      await repository.putDiscoveryPointer(pointer);
    }
    for (const key of plan.deletes) {
      await repository.deleteCatalogKey(key.PK, key.SK);
    }
  } catch (error) {
    report.failed += 1;
    logger.error({
      event: 'discovery_backfill_service_failed',
      vendorId: service.vendorId,
      serviceId: service.serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function classifyOrWrite(
  repository: ServicesRepository,
  item: ServiceDiscoveryEntity,
  dryRun: boolean,
): Promise<'created' | 'updated' | 'skipped'> {
  const existing = await repository.getDiscoveryItem(item.PK, item.SK);
  if (existing && (discoveryWriteBlocked(existing, item) || sameDiscoveryProjection(existing, item))) {
    return 'skipped';
  }
  if (dryRun) {
    return existing ? 'updated' : 'created';
  }
  return repository.saveDiscoveryIfCurrent(item);
}
