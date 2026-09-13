import {
  BankDetails,
  BankDetailsData,
  CreateBranchRequest,
  UpdateBranchRequest,
  VendorBranch,
} from '../types/api-types';
import {
  VendorBankDdbItem,
  VendorBranchDdbItem,
} from '../types/repository.types';
import {
  VENDOR_BANK_ENTITY_TYPE,
  VENDOR_BRANCH_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export function maskAccountNumber(accountNumber: string): {
  accountNumberLast4: string;
  accountNumberMasked: string;
} {
  const last4 = accountNumber.slice(-4);
  return {
    accountNumberLast4: last4,
    accountNumberMasked: `${'X'.repeat(Math.max(accountNumber.length - 4, 0))}${last4}`,
  };
}

export class BankDetailsMapper {
  static toDomain(item: VendorBankDdbItem): BankDetails {
    const masked = maskAccountNumber(item.accountNumber);
    return {
      vendorId: item.vendorId,
      accountHolderName: item.accountHolderName,
      accountNumberLast4: masked.accountNumberLast4,
      accountNumberMasked: masked.accountNumberMasked,
      ifscCode: item.ifscCode,
      bankName: item.bankName,
      branchName: item.branchName,
      accountType: item.accountType,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toDdbItem(
    vendorId: string,
    data: BankDetailsData,
    options?: { createdAt?: string },
  ): VendorBankDdbItem {
    const timestamp = new Date().toISOString();
    const createdAt = options?.createdAt || timestamp;

    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.bankSk(),
      vendorId,
      accountHolderName: data.accountHolderName,
      accountNumber: data.accountNumber,
      ifscCode: data.ifscCode,
      bankName: data.bankName,
      branchName: data.branchName,
      accountType: data.accountType,
      createdAt,
      updatedAt: timestamp,
      entityType: VENDOR_BANK_ENTITY_TYPE,
    };
  }
}

export class BranchesMapper {
  static toDomain(item: VendorBranchDdbItem): VendorBranch {
    return {
      branchId: item.branchId,
      vendorId: item.vendorId,
      name: item.name,
      phoneNumber: item.phoneNumber,
      email: item.email,
      address: item.address,
      geoLocation: item.geoLocation,
      isPrimary: item.isPrimary,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toDdbItem(
    request: CreateBranchRequest,
    vendorId: string,
    branchId: string,
    options?: { createdAt?: string; isPrimary?: boolean },
  ): VendorBranchDdbItem {
    const timestamp = new Date().toISOString();
    const createdAt = options?.createdAt || timestamp;

    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.branchSk(branchId),
      branchId,
      vendorId,
      name: request.name,
      phoneNumber: request.phoneNumber,
      email: request.email,
      address: request.address,
      geoLocation: request.geoLocation,
      isPrimary: options?.isPrimary ?? request.isPrimary ?? false,
      createdAt,
      updatedAt: timestamp,
      entityType: VENDOR_BRANCH_ENTITY_TYPE,
    };
  }

  static applyUpdate(
    existing: VendorBranchDdbItem,
    updates: UpdateBranchRequest,
  ): VendorBranchDdbItem {
    return {
      ...existing,
      name: updates.name ?? existing.name,
      phoneNumber:
        updates.phoneNumber !== undefined
          ? updates.phoneNumber
          : existing.phoneNumber,
      email: updates.email !== undefined ? updates.email : existing.email,
      address: updates.address !== undefined ? updates.address : existing.address,
      geoLocation:
        updates.geoLocation !== undefined
          ? updates.geoLocation
          : existing.geoLocation,
      isPrimary:
        updates.isPrimary !== undefined ? updates.isPrimary : existing.isPrimary,
      updatedAt: new Date().toISOString(),
    };
  }
}
