import {
  VendorAddressDdbItem,
  VendorBankDdbItem,
  VendorBranchDdbItem,
  VendorChildDdbItem,
  VendorDdbItem,
  VendorDocumentDdbItem,
  VendorOwnerDdbItem,
} from '../types/repository.types';
import {
  computeOnboardingState,
  isAddressComplete,
  isBankComplete,
  isBusinessInfoComplete,
  isOwnerComplete,
} from './onboarding';

export interface VendorAggregate {
  profile?: VendorDdbItem;
  owner?: VendorOwnerDdbItem;
  address?: VendorAddressDdbItem;
  bank?: VendorBankDdbItem;
  branches: VendorBranchDdbItem[];
  documents: VendorDocumentDdbItem[];
}

export function toVendorAggregate(
  items: VendorChildDdbItem[],
): VendorAggregate {
  const aggregate: VendorAggregate = {
    branches: [],
    documents: [],
  };

  for (const item of items) {
    switch (item.entityType) {
      case 'Vendor':
        aggregate.profile = item;
        break;
      case 'VendorOwner':
        aggregate.owner = item;
        break;
      case 'VendorAddress':
        aggregate.address = item;
        break;
      case 'VendorBank':
        aggregate.bank = item;
        break;
      case 'VendorBranch':
        aggregate.branches.push(item);
        break;
      case 'VendorDocument':
        aggregate.documents.push(item);
        break;
      default:
        break;
    }
  }

  return aggregate;
}

export function computeStateFromAggregate(aggregate: VendorAggregate) {
  return computeOnboardingState({
    hasBusinessInfo: Boolean(
      aggregate.profile && isBusinessInfoComplete(aggregate.profile),
    ),
    hasOwner: Boolean(aggregate.owner && isOwnerComplete(aggregate.owner)),
    hasAddress: Boolean(
      aggregate.address && isAddressComplete(aggregate.address),
    ),
    hasBranch: aggregate.branches.length > 0,
    documentTypes: aggregate.documents.map((item) => item.documentType),
    hasBankDetails: Boolean(aggregate.bank && isBankComplete(aggregate.bank)),
  });
}
