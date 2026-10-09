import { handler as attachHandler } from '../handlers/attach-pre-token-generation';
import { handler as backfillHandler } from '../handlers/backfill-customer-roles';
import { handler as preTokenHandler } from '../handlers/pre-token-generation';
import { handler as vendorEmailVerifiedHandler } from '../handlers/vendor-email-verified-role';

describe('role handlers', () => {
  it('exports the registration, token, backfill, and vendor-email-verified handlers', () => {
    expect(typeof preTokenHandler).toBe('function');
    expect(typeof backfillHandler).toBe('function');
    expect(typeof vendorEmailVerifiedHandler).toBe('function');
    expect(typeof attachHandler).toBe('function');
  });
});
