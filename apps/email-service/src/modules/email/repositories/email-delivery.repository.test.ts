import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { DELIVERY_STATUS } from '../domain/delivery-status.js';
import { DynamoDbEmailDeliveryStore } from './email-delivery.repository.js';

describe('DynamoDbEmailDeliveryStore', () => {
  it('claims with a conditional put and stores the message id conditionally', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const store = new DynamoDbEmailDeliveryStore('email-delivery', { send });
    await expect(
      store.claim({
        idempotencyKey: 'ntf-1',
        eventId: 'evt-1',
        eventType: 'Email.NotificationRequested',
        source: 'appointment-service',
        templateName: 'appointment-confirmation',
        recipientHash: 'hash',
      }),
    ).resolves.toEqual({ outcome: 'acquired' });
    await store.markSent('ntf-1', 'ses-1');

    expect(send.mock.calls[0][0]).toBeInstanceOf(PutCommand);
    expect(send.mock.calls[0][0].input.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(send.mock.calls[1][0]).toBeInstanceOf(UpdateCommand);
    expect(send.mock.calls[1][0].input.ConditionExpression).toContain('attribute_not_exists(messageId)');
    expect(send.mock.calls[1][0].input.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ':sent': DELIVERY_STATUS.SENT,
        ':messageId': 'ses-1',
        ':gsi1pk': 'MSG#ses-1',
        ':gsi1sk': 'STATUS',
      }),
    );
  });

  it('treats an existing sent record as a duplicate', async () => {
    const conditional = Object.assign(new Error('exists'), {
      name: 'ConditionalCheckFailedException',
    });
    const send = jest.fn().mockRejectedValueOnce(conditional).mockResolvedValueOnce({
      Item: {
        pk: 'DELIVERY#ntf-1',
        sk: 'STATUS',
        status: DELIVERY_STATUS.SENT,
        messageId: 'ses-9',
        updatedAt: new Date().toISOString(),
        eventId: 'evt-1',
        templateName: 'appointment-confirmation',
      },
    });
    const store = new DynamoDbEmailDeliveryStore('email-delivery', { send });
    await expect(
      store.claim({
        idempotencyKey: 'ntf-1',
        eventId: 'evt-1',
        eventType: 'Email.NotificationRequested',
        source: 'appointment-service',
        templateName: 'appointment-confirmation',
        recipientHash: 'hash',
      }),
    ).resolves.toEqual({
      outcome: 'duplicate',
      status: DELIVERY_STATUS.SENT,
      messageId: 'ses-9',
    });
  });
});
