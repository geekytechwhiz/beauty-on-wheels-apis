import { readFileSync } from 'fs';
import { join } from 'path';

describe('identity role infrastructure', () => {
  const template = readFileSync(
    join(__dirname, '../../serverless.yml'),
    'utf8',
  );

  it('registers pre-token generation without creating a user pool', () => {
    expect(template).toContain('handler: src/handlers/pre-token-generation.handler');
    expect(template).toContain('AWS::Lambda::Permission');
    expect(template).toContain('cognito-idp.amazonaws.com');
    expect(template).toContain('AWS::CloudFormation::CustomResource');
    expect(template).toContain('cognito-idp:DescribeUserPool');
    expect(template).toContain('cognito-idp:UpdateUserPool');
    expect(template).toContain('iam:PassRole');
    expect(template).not.toContain('AWS::Cognito::UserPool');
  });

  it('subscribes identity to vendor approval and suspension events', () => {
    expect(template).toContain('handler: src/handlers/vendor-approved-role.handler');
    expect(template).toContain('AWS::Events::Rule');
    expect(template).toContain('- VendorApproved');
    expect(template).toContain('- VendorSuspended');
    expect(template).toContain('vendor-event-bus-name');
  });
});
