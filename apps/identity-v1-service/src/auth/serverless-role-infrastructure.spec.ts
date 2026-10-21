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

  it('keeps pre-token generation on the identity-table read role for V2_0', () => {
    const fn = template.slice(
      template.indexOf('preTokenGeneration:'),
      template.indexOf('attachPreTokenGeneration:'),
    );
    const attach = readFileSync(
      join(__dirname, '../handlers/attach-pre-token-generation.ts'),
      'utf8',
    );
    expect(fn).toContain('src/handlers/pre-token-generation.handler');
    expect(fn).not.toContain('role:');
    expect(template).toContain('dynamodb:GetItem');
    expect(template).toContain('!GetAtt IdentityTable.Arn');
    expect(attach).toContain("LambdaVersion: 'V2_0'");
  });

  it('subscribes identity to vendor email verification events', () => {
    expect(template).toContain('handler: src/handlers/vendor-email-verified-role.handler');
    expect(template).toContain('AWS::Events::Rule');
    expect(template).toContain('- Vendor.EmailVerified');
    expect(template).toContain('vendor-event-bus-name');
  });
});
