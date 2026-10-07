# WhatsApp Channel Service

Nx microservice for the Beauty on Wheels WhatsApp pilot. It owns the Meta webhook, message formatting, conversation state, channel identity, and delivery consent. Catalog, vendors, vehicles, availability, pricing, bookings, and customer master data stay in their own services.

Reference services for this app are `email-service` (channel delivery, SQS, Serverless) and `vendor-service` / `booking-service` (Nx layout, DynamoDB, platform authorizer, response envelope).

## Local development

Unit tests do not need Meta credentials or AWS:

```bash
npx nx test @api-hub/whatsapp-channel-service
npx nx build @api-hub/whatsapp-channel-service
```

In-memory webhook server (loads `.env`, does not use DynamoDB):

```bash
cp apps/whatsapp-channel-service/.env.example apps/whatsapp-channel-service/.env
node --env-file=apps/whatsapp-channel-service/.env --import tsx apps/whatsapp-channel-service/src/local.ts
```

Serverless Offline, same shape as the other services:

```bash
npx nx serve @api-hub/whatsapp-channel-service
```

That listens on `http://localhost:4010`. Set `WHATSAPP_PROCESS_INLINE=true` in `.env` when you want the webhook Lambda to run the conversation in-process instead of SQS. `serverless-dotenv-plugin` loads `.env` for Offline. `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, and `SERVICE_AUTH_TOKEN` are excluded from the deployed Lambda environment. Leave the token overrides empty so the process reads `WHATSAPP_SECRET_NAME`.

Meta must reach a public HTTPS URL. Forward the local port with a tunnel, then set the callback to:

```text
https://<tunnel-host>/webhooks/whatsapp
```

Examples: `cloudflared tunnel --url http://localhost:4010` or `ngrok http 4010`.

## Meta configuration

1. Create a WhatsApp Cloud API app and phone number.
2. Set the callback URL above and the verify token from `WHATSAPP_VERIFY_TOKEN`.
3. Subscribe to `messages`.
4. Store the access token in the JSON secret named by `WHATSAPP_SECRET_NAME` (dev: `apdev-beauty-on-wheels/whatsapp`). Add `WHATSAPP_APP_SECRET` to that same secret when the Meta app secret is available. Do not commit either value. The Graph API version is `v25.0`.
5. Approved template names live in `src/templates/registry.ts`. Session messages inside the conversation use text and interactive replies. Templates are for out-of-session notifications.

`GET /webhooks/whatsapp` returns `hub.challenge` as plain text. `POST /webhooks/whatsapp` checks `X-Hub-Signature-256`, then enqueues the body. The inbound worker runs the conversation. Duplicate Meta message ids are acknowledged and not processed twice.

Send a text message through Meta:

```bash
curl -s -X POST http://localhost:4010/whatsapp/messages \
  -H 'content-type: application/json' \
  -d '{"to":"919876543210","message":"Hello from Car Wash WhatsApp!"}'
```

A successful response uses the platform envelope. `data.messageId` is the id Meta returned, and `data.to` is the recipient in E.164 digits. Meta errors come back as `success: false` with `error.code` of `WHATSAPP_SEND_FAILED` or `WHATSAPP_AUTH_FAILED`. The access token is never included. Use the in-memory server above, or `npx nx serve @api-hub/whatsapp-channel-service` (Serverless Offline prefixes the stage, so the path is `/dev/whatsapp/messages`).

This route is unauthenticated, same as the webhook routes in this service. Put it behind the platform authorizer before it is exposed beyond local testing. It can send messages with the business access token.

## AWS deployment

This service deploys with Serverless Framework, like the other apps. It does not add Terraform.

```bash
cd apps/whatsapp-channel-service
npx serverless deploy --stage dev
```

Create the WhatsApp secret before traffic. The dev name is `apdev-beauty-on-wheels/whatsapp`. Set `WHATSAPP_SECRET_NAME` per stage. Do not create `nv<stage>-bw/whatsapp/access-token`, `app-secret`, or `service-auth-token`.

The stack creates the conversation table, the inbound queue, and the dead-letter queue. Shared networking, the deployment bucket, and the platform authorizer stay in the platform repository.

## Conversation

Persisted states use camelCase: `welcome`, `mainMenu`, `browseCategory`, `selectService`, `selectProvider`, `selectVehicle`, `selectDate`, `selectSlot`, `priceReview`, `coupon`, `bookingReview`, `bookingConfirmation`, `paymentPending`, `booked`, `myBookings`, `bookingDetails`, `cancelBooking`, `help`, `error`, `expired`.

`MENU` returns to the main menu. `BACK` follows the state table in `src/flows/state-machine.ts`. `STOP` records marketing opt-out. Invalid input re-prompts the current step. An expired row starts a new session.

## Troubleshooting

- Webhook verification returns 403: `WHATSAPP_VERIFY_TOKEN` does not match the Meta console.
- Webhook POST returns 401: `WHATSAPP_APP_SECRET` is missing from the JSON secret, or it does not match the Meta app. The check fails closed until that field is present.
- Customers are asked to finish onboarding: there is no user lookup by phone. Set `WHATSAPP_CUSTOMER_LINKS` for a pilot, or add the user API documented in `INTEGRATION_NOTES.md`.
- Pricing or availability messages: those dependencies are not implemented in this repo. The channel does not invent prices or slots.
- CloudWatch logs use `@api-hub/observability` with PII redaction. Search by `correlationId`, `conversationId`, `whatsappMessageId`, `customerId`, or `bookingId`. Phone numbers are masked.

## Production checklist

- The secret `WHATSAPP_SECRET_NAME` exists and the Lambda role can `GetSecretValue` only on that secret.
- `WHATSAPP_ACCESS_TOKEN` is not in the template or the git history.
- `WHATSAPP_APP_SECRET` is present in that JSON secret before Meta webhook delivery is enabled.
- Downstream base URLs point at the deployed stage.
- Meta callback URL uses the deployed `/webhooks/whatsapp` route.
- Template names in the registry match approved Meta templates.
- DynamoDB point-in-time recovery and TTL on `expiresAt` are enabled.
- The inbound DLQ is alarmed.
- Marketing sends go through `OutboundMessageService` and require stored consent.
