import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('manager home serverless wiring', () => {
  it('secures getVendorHome with the platform authorizer', () => {
    const yaml = readFileSync(
      join(__dirname, '../../serverless.yml'),
      'utf8',
    );
    expect(yaml).toContain('path: /partner/{vendorId}/manager/home');
    expect(yaml).toContain('authorizer: ${self:custom.securedAuthorizer}');
    expect(yaml).toContain('name: VendorHomeResponse');
    expect(yaml).toMatch(/upcomingDays/);
  });
});
