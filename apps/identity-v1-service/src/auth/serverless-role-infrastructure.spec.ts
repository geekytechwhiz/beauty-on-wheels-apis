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

  it('subscribes identity to vendor email verification events', () => {
    expect(template).toContain('handler: src/handlers/vendor-email-verified-role.handler');
    expect(template).toContain('AWS::Events::Rule');
    expect(template).toContain('- Vendor.EmailVerified');
    expect(template).toContain('vendor-event-bus-name');
  });
});
