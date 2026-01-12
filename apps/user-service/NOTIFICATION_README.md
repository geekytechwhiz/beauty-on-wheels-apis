# Notification Delivery (consumer)

This service publishes `UserCreatedNotificationRequested` events when users should receive email/SMS/push notifications (for example on user creation or profile updates).

## Event: UserCreatedNotificationRequested

Event payload (envelope.data):

```ts
interface UserCreatedNotificationRequestedData {
  userId?: string;
  email?: string;
  phone?: string;
  name?: string;
  channels: string[]; // 'email', 'sms', 'push'
  template?: string; // e.g. 'WELCOME', 'PROFILE_UPDATED'
  templateData?: Record<string, unknown>;
}
```

## Consumer

`apps/user-service/src/consumers/notification.consumer.ts` is a Lambda handler intended to be subscribed to the SNS topic used by the service. It accepts SNS events and will forward delivery to `sendEmail`, `sendSms`, or `sendPush` depending on `channels`.

## Delivery helper

`apps/user-service/src/services/notification.delivery.ts` provides `sendEmail`, `sendSms` and `sendPush` helpers. They require secrets to be available in AWS Secrets Manager under the name in `NOTIFICATION_SECRET_NAME` (or `SECRET_MANAGER_NAME`). The expected secret JSON should include keys such as:

- `EMAIL_API_URL`
- `AUTHORIZATION_KEY`
- `SMS_API_URL`
- `DLT_CONTENT_ID` (or `DLT_CONTENT_ID`)

## Tests

Unit tests for delivery and consumer live under `src/services/__tests__` and `src/consumers/__tests__`. Run via the workspace test runner (e.g. `pnpm test` / `vitest`).

## Notes

- Delivery is best-effort; errors are logged. Consider adding a DLQ or retries for production traffic.
- `sendPush` is a placeholder. Integrate FCM/APNS as needed.
