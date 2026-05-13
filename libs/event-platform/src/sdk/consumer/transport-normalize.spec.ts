import { unwrapSnsNotificationPayload } from './transport-normalize';

describe('unwrapSnsNotificationPayload', () => {
  it('returns inner JSON when SNS subscription notification wraps BaseEvent JSON', () => {
    const inner = { eventId: 'e1', hello: 'world' };
    const outer = {
      Type: 'Notification',
      Message: JSON.stringify(inner),
      TopicArn: 'arn:aws:sns:us-east-1:123:t',
    };
    expect(unwrapSnsNotificationPayload(outer)).toEqual(inner);
  });

  it('returns Message string when Message is not JSON', () => {
    const outer = {
      Type: 'Notification',
      Message: 'plain-text-payload',
    };
    expect(unwrapSnsNotificationPayload(outer)).toBe('plain-text-payload');
  });

  it('passes through non-notification objects', () => {
    const direct = { a: 1 };
    expect(unwrapSnsNotificationPayload(direct)).toBe(direct);
  });
});
