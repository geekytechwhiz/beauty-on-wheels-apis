import { ServicesRepository } from '../repositories/services.repository';
import { DiscoveryFactsSnapshot } from '../integrations/vendor-discovery-facts';

/** Replaces the local copies used to build projections. Does not write SERVICE items. */
export async function persistDiscoveryFacts(
  repository: ServicesRepository,
  snapshot: DiscoveryFactsSnapshot,
): Promise<void> {
  const vendorId = snapshot.vendor.vendorId;
  await repository.saveVendorDiscoveryState(snapshot.vendor);

  const existingBranches = await repository.listBranchDiscoveryStates(vendorId);
  const nextBranches = new Set(snapshot.branches.map((branch) => branch.branchId));
  for (const branch of snapshot.branches) {
    await repository.saveBranchDiscoveryState(branch);
  }
  for (const branch of existingBranches) {
    if (!nextBranches.has(branch.branchId)) {
      await repository.deleteCatalogKey(branch.PK, branch.SK);
    }
  }

  const existingPrices = await repository.listPriceDiscoveryStates(vendorId);
  const nextPrices = new Set(snapshot.prices.map((price) => price.serviceId));
  for (const price of snapshot.prices) {
    await repository.savePriceDiscoveryState(price);
  }
  for (const price of existingPrices) {
    if (!nextPrices.has(price.serviceId)) {
      await repository.deleteCatalogKey(price.PK, price.SK);
    }
  }
}
