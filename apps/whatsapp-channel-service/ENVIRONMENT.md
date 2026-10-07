# Environment

Deployed Lambdas receive the variables below from `serverless.yml`. `DEFAULT_AWS_REGION` is set by Lambda and is not declared in the function environment.

WhatsApp credentials are one JSON secret in Secrets Manager. The secret name is `WHATSAPP_SECRET_NAME`. The current dev secret is `apdev-beauty-on-wheels/whatsapp`. Production supplies a different name in the deployment environment. Application code does not build the name from the stage or resource prefix.

```json
{
  "WHATSAPP_ACCESS_TOKEN": "<meta access token>",
  "WHATSAPP_PHONE_NUMBER_ID": "<phone number id>",
  "WHATSAPP_BUSINESS_ACCOUNT_ID": "<business account id>",
  "WHATSAPP_APP_SECRET": "<meta app secret>"
}
```

`WHATSAPP_APP_SECRET` is not in the secret yet. `POST /webhooks/whatsapp` validates `X-Hub-Signature-256` with HMAC-SHA256 and `timingSafeEqual`. Until `WHATSAPP_APP_SECRET` is added to this same secret, signature checks fail closed. Do not turn the check off and do not create a second secret for it.

`WHATSAPP_PHONE_NUMBER_ID` is the Graph path `/{phone-number-id}/messages`. `WHATSAPP_BUSINESS_ACCOUNT_ID` is the WhatsApp Business Account id. They are not interchangeable. Env values are used when set. The secret fills them in when the env values are empty.

`GET /health` does not read Secrets Manager and does not call Meta or downstream services. `GET /webhooks/whatsapp` uses only `WHATSAPP_VERIFY_TOKEN`.

`serverless-dotenv-plugin` excludes `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, and `SERVICE_AUTH_TOKEN` from the deployed template. Leave those empty so runtime code reads Secrets Manager. A non-empty local value is a test override and must not be committed.

| Name | Required | Purpose |
|---|---|---|
| `STAGE` | Yes | Deployment stage. Default `dev`. |
| `DEFAULT_AWS_REGION` | Injected | Region for DynamoDB and Secrets Manager. |
| `WHATSAPP_API_VERSION` | Yes | Graph API version. Default `v25.0`. |
| `WHATSAPP_SECRET_NAME` | Yes to send or validate POST signatures | Secrets Manager name. Dev default `apdev-beauty-on-wheels/whatsapp`. |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes to send | Meta phone number id. Dev value `1431657753354506`. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Yes | WhatsApp Business Account id. Dev value `1390181996618679`. |
| `WHATSAPP_VERIFY_TOKEN` | Yes | Meta webhook verify token. Not stored in the WhatsApp secret. |
| `WHATSAPP_ACCESS_TOKEN` | Local override only | When empty, the access token comes from the JSON secret. Never put this in `serverless.yml`. |
| `WHATSAPP_APP_SECRET` | Local override only | When empty, `WHATSAPP_APP_SECRET` is taken from the same JSON secret if present. |
| `WHATSAPP_CONVERSATION_TABLE` | Yes | Set to `${service}-${stage}-conversations` by the stack. |
| `CATALOG_SERVICE_URL` | Yes to browse | Service Catalog base URL. |
| `AVAILABILITY_SERVICE_URL` | Yes to book | Availability base URL. |
| `PRICING_SERVICE_URL` | When pricing exists | Empty until a pricing service is deployed. |
| `BOOKING_SERVICE_URL` | Yes to book | Booking base URL. |
| `USER_SERVICE_URL` | Yes to mirror consent | User service base URL. |
| `VEHICLE_SERVICE_URL` | Yes to choose a vehicle | Vehicle base URL. |
| `VENDOR_SERVICE_URL` | Yes to choose a provider | Vendor base URL. |
| `SERVICE_AUTH_TOKEN` | No | Optional local bearer for downstream calls. This repo has no shared service-auth secret. Health and webhook verification do not use it. |
| `CONVERSATION_TTL_SECONDS` | No | Conversation TTL. Default `1800`. |
| `DOWNSTREAM_TIMEOUT_MS` | No | Per downstream and Meta call. Default `8000`. |
| `WHATSAPP_PROCESS_INLINE` | No | `true` handles the webhook in the HTTP Lambda. Deployed default is `false` (SQS). |
| `INBOUND_QUEUE_URL` | Yes in AWS | Set from the queue created by this stack. |
| `WHATSAPP_PILOT_VENDOR_IDS` | No | Comma-separated vendor ids. When empty, the channel calls `GET /vendors?status=ACTIVE`. |
| `WHATSAPP_CUSTOMER_LINKS` | No | JSON object of WhatsApp digits to `customerId`. Pilot stand-in for the missing phone lookup. |
| `WHATSAPP_BUSINESS_NAME` | No | Welcome text. Default `Beauty on Wheels`. |
| `DEFAULT_TIMEZONE` | No | Date buttons. Default `Asia/Kolkata`. |
| `PORT` | No | Local HTTP server port. Default `4010`. Not set on Lambda. |
| `LOG_LEVEL` | No | `INFO` in the stack. Observability defaults to `ERROR` if this is unset. |
| `METRICS_NAMESPACE` | No | Default `ApiHub`, shared with `@api-hub/observability`. |
| `SERVICE_NAME` | Yes | `whatsapp-channel-service`. |

`REDACT_PII` stays `true`. Logs may include `secretName`. They must not include secret values or `Authorization` headers.
