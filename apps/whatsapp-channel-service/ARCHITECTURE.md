# Architecture

```text
WhatsApp
    |
    v
API Gateway  GET/POST /webhooks/whatsapp
    |
    v
webhook Lambda  (verify token + HMAC, enqueue, return 200)
    |
    v
SQS + DLQ
    |
    v
inbound Lambda
    |
    +-- DynamoDB conversation table
    +-- Meta Cloud API
    +-- Catalog, Vendor, Vehicle, Availability, Pricing, Booking, User
```

`local.ts` and `WHATSAPP_PROCESS_INLINE=true` skip the queue and run the same handler in process.

## Ownership

WhatsApp Channel owns webhook verification, Meta sends, templates, conversation state, channel identity, marketing delivery consent, and message idempotency.

It does not own the catalog, prices, coupons, availability, customer master, vehicles, booking lifecycle, or payments. There is no payment service in this repo. A confirmed booking with `paymentStatus=PENDING` stays in `paymentPending` and tells the customer that in-chat payment is not available.

## DynamoDB

Single table, keys `PK` + `SK`, on-demand, TTL attribute `expiresAt`, point-in-time recovery, SSE.

| Item | PK | SK | TTL |
|---|---|---|---|
| Conversation | `CONV#<channelUserId>` | `STATE` | Yes (`expiresAt` epoch seconds) |
| Identity | `IDENT#WHATSAPP#<channelUserId>` | `IDENTITY` | No |
| Marketing consent | `CONSENT#WHATSAPP#<channelUserId>` | `MARKETING` | No |
| Processed event | `MSG#<eventId>` | `PROCESSED` | 7 days |

Conversation attributes: `conversationId`, `channel` (`whatsapp`), `channelUserId`, `customerId`, `state`, `context`, `createdAt`, `updatedAt`, `expiresAt`, `version`, optional `activeBookingId`. `entityType` is `Conversation`, `ChannelIdentity`, `MarketingConsent`, or `ProcessedEvent`.

`context` stores only ids plus the price object returned by pricing. It does not store a customer profile.

Saves use `version` as a condition. Booking confirmation writes a claim first (`bookingClaim`). A second confirmation sees `inProgress` or `activeBookingId` and does not call `POST /bookings` again. After create, `activeBookingId` is stored before confirm. A retry loads that id and confirms if the booking is still `CREATED` or `PENDING`.

Webhook idempotency is the Meta message id. The worker puts `MSG#<id>` with `attribute_not_exists` (or a stale processing lock). A duplicate returns without running the flow. A failed attempt deletes the processing row so SQS can retry. Booking POSTs are still not blindly retried.

## Errors

Downstream failures become `ChannelError` codes: `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `UNAVAILABLE`, `TIMEOUT`, `AUTHENTICATION_ERROR`, `AUTHORIZATION_ERROR`, `META_API_ERROR`, `INTERNAL_ERROR`. Customers see a short sentence from `customerMessage`. Logs include the code, dependency, and correlation id, not tokens or full phone numbers.

Webhook JSON responses use `ApiResponse` from `@api-hub/utils`. The Meta challenge is the exception: it is plain text, because Meta requires the raw `hub.challenge`.

## Observability

`@api-hub/observability` supplies the logger, PII redaction, and correlation context. Metrics, in namespace `ApiHub`:

- `whatsapp.messages.received`
- `whatsapp.messages.sent`
- `whatsapp.messages.failed`
- `whatsapp.webhook.failed`
- `whatsapp.conversation.started`
- `whatsapp.conversation.completed`
- `whatsapp.booking.started`
- `whatsapp.booking.completed`
- `whatsapp.booking.failed`
- `whatsapp.meta.api.failed`

GET retries also emit `UpstreamRetryAttempts`.

## IAM

The Lambda role can `GetItem`, `PutItem`, `UpdateItem`, and `DeleteItem` on the conversation table only. It can send, receive, delete, and read attributes on the inbound queue and its DLQ. It can `GetSecretValue` only on the secret named by `WHATSAPP_SECRET_NAME`. X-Ray permissions match the other traced services. There is no `dynamodb:*`, `secretsmanager:*`, or `ssm:*`.

## What this stack does not create

Terraform, VPC networking, the platform authorizer, Cognito, the deployment bucket, and the downstream services are outside this app. CI is the existing Nx pipeline (`lint`, `test`, `build`) plus `serverless deploy` for this service. Packaging uses `serverless-esbuild` and the shared `@api-hub/*` resolver plugin.
