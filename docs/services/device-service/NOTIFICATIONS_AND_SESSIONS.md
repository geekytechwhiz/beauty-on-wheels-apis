# Device Service – Notifications and Session Notes

## Implemented Notification Flows

### 1. Device error – Email/SMS/push via error_notification API
- **API:** `POST /devices/error-notification` (device-service)
- **Body:** `userId?`, `email?`, `phone?`, `deviceToken?`, `name?`, `channels?` (default `['email','sms','push']`), `template?`, `templateData?`, `deviceId?`, `errorCode?`
- **Flow:** Handler validates body, calls `publishDeviceErrorNotification()` which publishes `DeviceErrorNotificationRequested` to the user-service SNS topic (`NOTIFICATION_TOPIC_ARN`). User-service notification consumer delivers to email/SMS/push.

### 2. Vital reading DLQ – SES email after 3 retries
- **Current:** Messages that fail processing (e.g. vital readings) are sent to **VitalReadingsDLQ** (SQS) after 3 retries (configure redrivePolicy on the main vital-readings queue to point to this DLQ).
- **Lambda:** `vitalReadingDlqHandler` is triggered by `VitalReadingsDLQ`. Message shape: `{ userId?, deviceId?, s3Path? }` (or `s3Key` / `s3_key`). Sends one SES email to `VITAL_READING_DLQ_TO_EMAIL` or `SES_ADMIN_EMAIL` with body: User ID, Device ID, S3 path.
- **Env:** `VITAL_READING_DLQ_FROM_EMAIL`, `VITAL_READING_DLQ_TO_EMAIL` (or `SES_ADMIN_EMAIL`). Ensure SES identity is verified.

### 3. Recommend services – Push + SMS + email
- **Current:** API `POST /devices/recommendations/add` (device-service).
- **Flow:** After creating recommendations and publishing `Device.Recommended` (EventBridge), device-service also publishes `RecommendationNotificationRequested` to the user-service SNS topic with `userId` (patient), `organizationId`, `doctorName`, `devices`. User-service notification consumer resolves patient contact (email/phone/deviceToken) from user table and delivers to email + SMS + push.

---

## Payment status (completed/cancelled/refunded/refund_initiated)
- **Current:** API `update_user_payment_status` / payment webhook calls `handlePaymentEvent` in order-service.
- **New flow (recommended):** When order-service updates payment status to completed/cancelled/refunded/refund_initiated, it should publish `PaymentStatusNotificationRequested` to the same user-service SNS topic (`NOTIFICATION_TOPIC_ARN`). User-service notification consumer already handles this event type: it resolves user contact from `userId` + `organizationId` and sends Push + SMS + email.
- **Implementation in order-service:** Add `NOTIFICATION_TOPIC_ARN` (same as user-service topic), SNS publish, and in `handlePaymentEvent` after `updateUserOrderStatus`, call a notification publisher with `userId`, `orgId`, `orderId`, `status`; consumer will deliver.

---

## Session created/expired
- **Current:** Handled by scheduler Lambda (e.g. cron that checks session state).
- **Alternative:** Can be driven by **session/package table stream** if session state is stored in DB: on INSERT/MODIFY of session records, emit an event and have a consumer send session-created or session-expired notifications. This would require session table (or package table) to have a DynamoDB stream and a Lambda that publishes to the notification topic when session state transitions to created/expired.
