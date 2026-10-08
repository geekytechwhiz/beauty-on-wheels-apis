import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('email-service infrastructure', () => {
  const template = readFileSync(join(__dirname, '../../../../serverless.yml'), 'utf8');

  it('routes email events through EventBridge into SQS and a consumer', () => {
    expect(template).toContain('AWS::Events::Rule');
    expect(template).toContain('Email.NotificationRequested');
    expect(template).toContain('VendorOnboarding.Submitted');
    expect(template).toContain('Booking.Confirmed');
    expect(template).toContain('VendorEmailVerification.Requested');
    expect(template).toContain('Arn: !GetAtt EmailNotificationQueue.Arn');
    expect(template).not.toMatch(/emailNotification:[\s\S]*eventBridge:/);
  });

  it('buffers sends and SES lifecycle events with DLQs', () => {
    expect(template).toContain('EmailNotificationQueue:');
    expect(template).toContain('EmailNotificationDlq:');
    expect(template).toContain('EmailDeliveryQueue:');
    expect(template).toContain('EmailDeliveryDlq:');
    expect(template).toContain('VisibilityTimeout: 180');
    expect(template).toContain('maxReceiveCount: 5');
    expect(template).toContain('functionResponseType: ReportBatchItemFailures');
    expect(template).toContain('reservedConcurrency: 5');
  });

  it('persists delivery state and grants only the SES and DynamoDB actions the consumer uses', () => {
    expect(template).toContain('AWS::DynamoDB::Table');
    expect(template).toContain('EMAIL_DELIVERY_TABLE:');
    expect(template).toContain('ses:SendEmail');
    expect(template).toContain('dynamodb:PutItem');
    expect(template).toContain('dynamodb:UpdateItem');
    expect(template).toContain('AWS::SES::ConfigurationSet');
    expect(template).toContain('Email Sent');
    expect(template).toContain('Email Bounced');
    expect(template).toContain('Email Complaint');
    expect(template).toContain('identity/*');
    expect(template).toContain('template/*');
    expect(template).not.toContain('ses:SendEmail\n          Resource: \'*\'');
  });
});
