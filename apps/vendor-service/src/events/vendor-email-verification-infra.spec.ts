import { readFileSync } from 'fs';
import { join } from 'path';

describe('vendor profile stream infrastructure', () => {
  const vendorServerless = readFileSync(
    join(__dirname, '../../serverless.yml'),
    'utf8',
  );
  const emailServerless = readFileSync(
    join(__dirname, '../../../email-service/serverless.yml'),
    'utf8',
  );
  const identityServerless = readFileSync(
    join(__dirname, '../../../identity-v1-service/serverless.yml'),
    'utf8',
  );

  it('reuses the existing Vendor table with NEW_AND_OLD_IMAGES streams', () => {
    expect(vendorServerless).toContain('VendorTable:');
    expect(vendorServerless).toContain('StreamSpecification:');
    expect(vendorServerless).toContain('StreamViewType: NEW_AND_OLD_IMAGES');
  });

  it('declares exactly one vendor-table Lambda stream consumer', () => {
    const streamArnMatches = vendorServerless.match(
      /!GetAtt VendorTable\.StreamArn/g,
    );
    expect(streamArnMatches).toHaveLength(1);

    expect(vendorServerless).toContain('onVendorEmailVerificationRequested:');
    expect(vendorServerless).toContain(
      'src/handlers/vendor-email-verification-stream.handler',
    );
    expect(vendorServerless).toContain(
      '${self:custom.resourcePrefix}-vendor-email-verification-stream',
    );
    expect(vendorServerless).toContain(
      'functionResponseType: ReportBatchItemFailures',
    );
    expect(vendorServerless).toContain('VendorEmailVerificationStreamDlq');
    expect(vendorServerless).toContain('maximumRetryAttempts: 3');
    expect(vendorServerless).toContain('- INSERT');
    expect(vendorServerless).toContain('- MODIFY');
  });

  it('routes VendorEmailVerification.Requested on the vendor bus to Email Service', () => {
    expect(emailServerless).toContain('VendorEmailVerification.Requested');
    expect(emailServerless).toContain('VENDOR_EMAIL_VERIFICATION');
    expect(emailServerless).toContain('EmailNotificationDlq');
    expect(emailServerless).toContain('MaximumRetryAttempts: 3');
  });

  it('routes Vendor.AccountProvisioningRequested to Identity without a second vendor stream', () => {
    expect(identityServerless).toContain('Vendor.AccountProvisioningRequested');
    expect(identityServerless).toContain('vendorAccountProvisioning:');
    expect(identityServerless).not.toContain('!GetAtt VendorTable.StreamArn');
  });
});
