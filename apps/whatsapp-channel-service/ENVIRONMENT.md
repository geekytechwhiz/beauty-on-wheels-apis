# Environment

Deployed Lambdas receive the variables below from `serverless.yml`. `DEFAULT_AWS_REGION` is set by Lambda and is not declared in the function environment.

Access tokens are not function environment variables. Local `.env` values are excluded by `serverless-dotenv-plugin` so they are not copied into the CloudFormation template. Runtime code uses a local value when the process already has one (unit tests and `local.ts`) and otherwise calls Secrets Manager.

| Name | Required | Purpose |
|---|---|---|
| `STAGE` | Yes | Deployment stage. Default `dev`. |
| `DEFAULT_AWS_REGION` | Injected | Region for DynamoDB and Secrets Manager. |
| `WHATSAPP_API_VERSION` | Yes | Graph API version. Default `v23.0`. |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | Meta phone number id used to send messages. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Yes for operations | WhatsApp Business Account id. Missing value is logged; send uses the phone number id. |
| `WHATSAPP_VERIFY_TOKEN` | Yes | Meta webhook verify token. Set by the pipeline. Do not commit it. |
| `WHATSAPP_ACCESS_TOKEN_SECRET` | Yes in AWS | Secrets Manager name. Default `nv<stage>-bw/whatsapp/access-token`. |
| `WHATSAPP_APP_SECRET_NAME` | Yes in AWS | Secrets Manager name. Default `nv<stage>-bw/whatsapp/app-secret`. |
| `WHATSAPP_ACCESS_TOKEN` | Local only | Overrides the access-token secret. Never put this in `serverless.yml`. |
| `WHATSAPP_APP_SECRET` | Local only | Overrides the app-secret. Never put this in `serverless.yml`. |
| `WHATSAPP_CONVERSATION_TABLE` | Yes | Set to `${service}-${stage}-conversations` by the stack. |
| `CATALOG_SERVICE_URL` | Yes to browse | Service Catalog base URL. |
| `AVAILABILITY_SERVICE_URL` | Yes to book | Availability base URL. |
| `PRICING_SERVICE_URL` | When pricing exists | Empty until a pricing service is deployed. |
| `BOOKING_SERVICE_URL` | Yes to book | Booking base URL. |
| `USER_SERVICE_URL` | Yes to mirror consent | User service base URL. |
| `VEHICLE_SERVICE_URL` | Yes to choose a vehicle | Vehicle base URL. |
| `VENDOR_SERVICE_URL` | Yes to choose a provider | Vendor base URL. |
| `SERVICE_AUTH_TOKEN_SECRET` | Yes in AWS | Secret containing the bearer token for the platform authorizer. |
| `SERVICE_AUTH_TOKEN` | Local only | Overrides that secret. |
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

`REDACT_PII` stays `true`.
