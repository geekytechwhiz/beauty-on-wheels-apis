import { readFileSync } from 'fs';
import { join } from 'path';

describe('vendor email verification stream infrastructure', () => {
  const vendorServerless = readFileSync(
    join(__dirname, '../../serverless.yml'),
    'utf8',
  );
  const emailServerless = readFileSync(
    join(__dirname, '../../../email-service/serverless.yml'),
    'utf8',
  );

  it('reuses the existing Vendor table with NEW_AND_OLD_IMAGES streams', () => {
    expect(vendorServerless).toContain('VendorTable:');
    expect(vendorServerless).toContain('StreamSpecification:');
    expect(vendorServerless).toContain('StreamViewType: NEW_AND_OLD_IMAGES');
  });

  it('wires the confirmation stream handler to VendorTable.StreamArn with retry and DLQ', () => {
    expect(vendorServerless).toContain('onVendorEmailVerificationRequested:');
    expect(vendorServerless).toContain(
      'src/handlers/vendor-email-verification-stream.handler.main',
    );
    expect(vendorServerless).toContain('!GetAtt VendorTable.StreamArn');
    expect(vendorServerless).toContain(
      'functionResponseType: ReportBatchItemFailures',
    );
    expect(vendorServerless).toContain('VendorEmailVerificationStreamDlq');
    expect(vendorServerless).toContain('maximumRetryAttempts: 3');
  });

  it('routes VendorEmailVerification.Requested on the vendor bus to Email Service', () => {
    expect(emailServerless).toContain('VendorEmailVerification.Requested');
    expect(emailServerless).toContain('vendor_email_confirmation');
    expect(emailServerless).toContain('EmailNotificationDlq');
    expect(emailServerless).toContain('maximumRetryAttempts: 3');
  });
});
