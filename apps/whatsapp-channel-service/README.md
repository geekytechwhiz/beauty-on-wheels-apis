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

That listens on `http://localhost:4010`. Set `WHATSAPP_PROCESS_INLINE=true` in `.env` when you want the webhook Lambda to run the conversation in-process instead of SQS. `serverless-dotenv-plugin` loads `.env` for Offline, and the access token, app secret, and service token are excluded from the deployed Lambda environment.

Meta must reach a public HTTPS URL. Forward the local port with a tunnel, then set the callback to:

```text
https://<tunnel-host>/webhooks/whatsapp
```

Examples: `cloudflared tunnel --url http://localhost:4010` or `ngrok http 4010`.

## Meta configuration

1. Create a WhatsApp Cloud API app and phone number.
2. Set the callback URL above and the verify token from `WHATSAPP_VERIFY_TOKEN`.
3. Subscribe to `messages`.
4. Store the access token and app secret in Secrets Manager (see `ENVIRONMENT.md`). Do not commit them.
5. Approved template names live in `src/templates/registry.ts`. Session messages inside the conversation use text and interactive replies. Templates are for out-of-session notifications.

`GET /webhooks/whatsapp` returns `hub.challenge` as plain text. `POST /webhooks/whatsapp` checks `X-Hub-Signature-256`, then enqueues the body. The inbound worker runs the conversation. Duplicate Meta message ids are acknowledged and not processed twice.

## AWS deployment

This service deploys with Serverless Framework, like the other apps. It does not add Terraform.

```bash
cd apps/whatsapp-channel-service
npx serverless deploy --stage dev
```

Create these secrets before traffic:

- `nv<stage>-bw/whatsapp/access-token`
- `nv<stage>-bw/whatsapp/app-secret`
- `nv<stage>-bw/whatsapp/service-auth-token`

The stack creates the conversation table, the inbound queue, and the dead-letter queue. Shared networking, the deployment bucket, and the platform authorizer stay in the platform repository.

## Conversation

Persisted states use camelCase: `welcome`, `mainMenu`, `browseCategory`, `selectService`, `selectProvider`, `selectVehicle`, `selectDate`, `selectSlot`, `priceReview`, `coupon`, `bookingReview`, `bookingConfirmation`, `paymentPending`, `booked`, `myBookings`, `bookingDetails`, `cancelBooking`, `help`, `error`, `expired`.

`MENU` returns to the main menu. `BACK` follows the state table in `src/flows/state-machine.ts`. `STOP` records marketing opt-out. Invalid input re-prompts the current step. An expired row starts a new session.

## Troubleshooting

- Webhook verification returns 403: `WHATSAPP_VERIFY_TOKEN` does not match the Meta console.
- Webhook POST returns 401: the app secret used for the HMAC is not the secret stored for this app.
- Customers are asked to finish onboarding: there is no user lookup by phone. Set `WHATSAPP_CUSTOMER_LINKS` for a pilot, or add the user API documented in `INTEGRATION_NOTES.md`.
- Pricing or availability messages: those dependencies are not implemented in this repo. The channel does not invent prices or slots.
- CloudWatch logs use `@api-hub/observability` with PII redaction. Search by `correlationId`, `conversationId`, `whatsappMessageId`, `customerId`, or `bookingId`. Phone numbers are masked.

## Production checklist

- Secrets exist and the Lambda role can `GetSecretValue` only those three secrets.
- `WHATSAPP_ACCESS_TOKEN` is not in the template or the git history.
- Downstream base URLs point at the deployed stage.
- The platform authorizer accepts the service token.
- Meta callback URL uses the deployed `/webhooks/whatsapp` route.
- Template names in the registry match approved Meta templates.
- DynamoDB point-in-time recovery and TTL on `expiresAt` are enabled.
- The inbound DLQ is alarmed.
- Marketing sends go through `OutboundMessageService` and require stored consent.
