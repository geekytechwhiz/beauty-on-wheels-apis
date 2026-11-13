import { randomInt } from 'node:crypto';

/** Stable codes: never reassign a code after IDs have been issued. */
  const ENTITY_CODES = Object.freeze({
  vendor: 'VN',
  customer: 'CU',
  booking: 'BK',
  service: 'SV',
  offering: 'OF',
  staff: 'ST',
  user: 'U',
  proposal: 'PR',
  commitment: 'CM',
  community: 'CO',
  team: 'TM',
  address: 'AD',
  addOn: 'AO',
  branch: 'BR',
  bookingChange: 'BC',
  capacityChangeRequest: 'CR',
  category: 'CA',
  document: 'DC',
  ledgerEntry: 'LE',
  hold: 'HO',
  holiday: 'HY',
  issue: 'IS',
  package: 'PA',
  payment: 'PY',
  plan: 'PL',
  review: 'RV',
  serviceArea: 'SA',
  serviceVisit: 'VI',
  statement: 'SS',
  suggestion: 'SG',
  supportTicket: 'TK',
  vehicle: 'VH',
} as const);

  type EntityType = keyof typeof ENTITY_CODES;
 
function generateEntityId(entity: EntityType): string {
  if (!Object.prototype.hasOwnProperty.call(ENTITY_CODES, entity)) {
    throw new TypeError(`Unsupported entity type: ${String(entity)}`);
  }

  const utcDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // randomInt avoids modulo bias. Each independent block is exactly 8 digits.
  const randomDigits = Array.from({ length: 3 }, () =>
    randomInt(0, 100_000_000).toString().padStart(8, '0'),
  ).join('');

  return `${ENTITY_CODES[entity]}-${utcDate}-${randomDigits}`;
}

export const VendorId = () => {
  return generateEntityId('vendor');
}

export const CustomerId = () => {
  return generateEntityId('customer');
}

export const BookingId = () => {
  return generateEntityId('booking');
}

export const ServiceId = () => {
  return generateEntityId('service');
}

export const OfferingId = () => {
  return generateEntityId('offering');
}

export const StaffId = () => {
  return generateEntityId('staff');
}

export const UserId = () => {
  return generateEntityId('user');
}

export const ProposalId = () => {
  return generateEntityId('proposal');
}

export const CommitmentId = () => {
  return generateEntityId('commitment');
}

export const CommunityId = () => {
  return generateEntityId('community');
}

export const TeamId = () => {
  return generateEntityId('team');
}

export const AddressId = () => generateEntityId('address');
export const AddOnId = () => generateEntityId('addOn');
export const BranchId = () => generateEntityId('branch');
export const BookingChangeId = () => generateEntityId('bookingChange');
export const CapacityChangeRequestId = () => generateEntityId('capacityChangeRequest');
export const CategoryId = () => generateEntityId('category');
export const DocumentId = () => generateEntityId('document');
export const LedgerEntryId = () => generateEntityId('ledgerEntry');
export const HoldId = () => generateEntityId('hold');
export const HolidayId = () => generateEntityId('holiday');
export const IssueId = () => generateEntityId('issue');
export const PackageId = () => generateEntityId('package');
export const PaymentId = () => generateEntityId('payment');
export const PlanId = () => generateEntityId('plan');
export const ReviewId = () => generateEntityId('review');
export const ServiceAreaId = () => generateEntityId('serviceArea');
export const ServiceVisitId = () => generateEntityId('serviceVisit');
export const StatementId = () => generateEntityId('statement');
export const SuggestionId = () => generateEntityId('suggestion');
export const SupportTicketId = () => generateEntityId('supportTicket');
export const VehicleId = () => generateEntityId('vehicle');


export const EntityIdGenerator = {
  VendorId,
  CustomerId,
  BookingId,
  ServiceId,
  OfferingId,
  StaffId,
  UserId,
  ProposalId,
  CommitmentId,
  CommunityId,
  TeamId,
  AddressId,
  AddOnId,
  BranchId,
  BookingChangeId,
  CapacityChangeRequestId,
  CategoryId,
  DocumentId,
  LedgerEntryId,
  HoldId,
  HolidayId,
  IssueId,
  PackageId,
  PaymentId,
  PlanId,
  ReviewId,
  ServiceAreaId,
  ServiceVisitId,
  StatementId,
  SuggestionId,
  SupportTicketId,
  VehicleId,
} as const;
