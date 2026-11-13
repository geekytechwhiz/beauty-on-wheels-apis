import { EntityIdGenerator } from './entity-id';

describe('EntityIdGenerator', () => {
  it.each([
    ['VendorId', 'VN'], ['CustomerId', 'CU'], ['BookingId', 'BK'], ['ServiceId', 'SV'],
    ['OfferingId', 'OF'], ['StaffId', 'ST'], ['UserId', 'U'], ['ProposalId', 'PR'],
    ['CommitmentId', 'CM'], ['CommunityId', 'CO'], ['TeamId', 'TM'],
    ['AddressId', 'AD'], ['AddOnId', 'AO'], ['BranchId', 'BR'], ['BookingChangeId', 'BC'],
    ['CapacityChangeRequestId', 'CR'], ['CategoryId', 'CA'], ['DocumentId', 'DC'],
    ['LedgerEntryId', 'LE'], ['HoldId', 'HO'], ['HolidayId', 'HY'], ['IssueId', 'IS'],
    ['PackageId', 'PA'], ['PaymentId', 'PY'], ['PlanId', 'PL'], ['ReviewId', 'RV'],
    ['ServiceAreaId', 'SA'], ['ServiceVisitId', 'VI'], ['StatementId', 'SS'],
    ['SuggestionId', 'SG'], ['SupportTicketId', 'TK'], ['VehicleId', 'VH'],
  ] as const)('creates a stable %s prefix', (generator, prefix) => {
    expect(EntityIdGenerator[generator]()).toMatch(new RegExp(`^${prefix}-\\d{8}-\\d{24}$`));
  });

  it('generates distinct IDs for separate creation attempts', () => {
    expect(EntityIdGenerator.BookingId()).not.toBe(EntityIdGenerator.BookingId());
  });
});
