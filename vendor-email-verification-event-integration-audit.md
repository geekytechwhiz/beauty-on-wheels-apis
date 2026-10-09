# Vendor Email Verification Event — Integration Gap Analysis

Audit date: 2026-10-09  
Scope: read-only source, staged working-tree changes, local Serverless-generated CloudFormation, and attempted read-only AWS inspection. No application, infrastructure, configuration, deployment, or queue state was modified.

## A. Executive Summary

**Publisher implemented:** Yes, in the local/staged Vendor Service source. The DynamoDB-stream handler maps an eligible `PROFILE` `MODIFY` to `VendorEmailVerification.Requested`, publishes through the shared Event Platform/EventBridge adapter, and retries failed stream records.

**Eligible during the current onboarding flow:** The backend can reach the eligibility transition after the five sections `BUSINESS_INFO`, `OWNER_DETAILS`, `ADDRESS`, `BRANCH`, and `BANK_DETAILS` become complete while the vendor lifecycle status remains `PENDING_VERIFICATION`. Documents are *not* one of the five email-trigger sections. The repository contains no frontend application, so the actual frontend's API calls/order cannot be proven. The backend API flow is capable of reaching it; deployed/frontend execution is unverified.

**EventBridge routing configured:** Yes in `apps/email-service/serverless.yml` and the local packaged CloudFormation: the rule matches `source=vendor-service` and `detail-type=VendorEmailVerification.Requested` on the imported `nvdev-bw-vendor-event-bus` and targets `EmailNotificationQueue`.

**Email Service subscribed:** Yes in declared/generated infrastructure: `EmailNotificationQueue` is enabled as an SQS source for `nvdev-bw-email-notification`.

**Correct template configured:** The current local/staged environment mapping resolves the event to `VENDOR_EMAIL_VERIFICATION`, not `vendor_email_confirmation`. However, the repository template named `VENDOR_EMAIL_VERIFICATION` requires incompatible variables (`ownerName`, `businessName`, `verificationUrl`) while the event adapter supplies (`firstName`, `otp`, `expiryMinutes`). If that repository template is the SES template deployed under this name, every message fails parameter validation before SES dispatch.

**End-to-end verified:** No. All deployed AWS checks were blocked by the IAM policy `force-mfa`; source/generated artifacts are not runtime proof.

**Most likely blocker:** P0 template-data mismatch. A second P0 deployment risk is that all relevant code is staged local work and cannot be shown to be deployed; an older deployed Email Service may still use the former `vendor_email_confirmation` mapping.

## B. End-to-End Wiring Matrix

| Step | Component | Expected | Actual finding | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Vendor DynamoDB Stream | PROFILE MODIFY triggers handler | `VendorTable` uses `NEW_AND_OLD_IMAGES`; generated mapping is enabled and filters `MODIFY`, `entityType=Vendor`, `SK=PROFILE`. | UNVERIFIED | `apps/vendor-service/serverless.yml:281-310,1594-1595`; generated `apps/vendor-service/.serverless/cloudformation-template-update-stack.json` resource `OnVendorEmailVerificationRequestedEventSourceMappingDynamodbVendorTable` |
| 2 | Stream mapper | Detect eligible verification request | Detects first completion of five required sections, unverified/unconsumed email, lifecycle `PENDING_VERIFICATION`, and validates email/request ID/first name/token. | WIRED | `apps/vendor-service/src/events/map-vendor-email-verification-requested-stream.ts:21-37,89-121` |
| 3 | Event publisher | Publish `VendorEmailVerification.Requested` | Handler invokes shared `publishEvent` via `EventBridgeAdapter`; stable key includes vendor and verification request. Failed publish is rethrown for stream retry. | WIRED | `apps/vendor-service/src/handlers/vendor-email-verification-stream.ts:32-66`; `apps/vendor-service/src/events/publish-vendor-email-verification.ts:12-24` |
| 4 | EventBridge rule | Match source/detail-type | Rule is enabled on imported vendor bus and exactly matches `vendor-service` / `VendorEmailVerification.Requested`. | UNVERIFIED | `apps/email-service/serverless.yml:572-593`; generated template resource `VendorEmailVerificationRule` |
| 5 | SQS target | Receive matching event | Rule targets `EmailNotificationQueue`; queue policy permits `events.amazonaws.com` from this account; target retry and DLQ declared. | UNVERIFIED | `apps/email-service/serverless.yml:408-425,587-593` |
| 6 | Email Lambda | Consume SQS message | Enabled SQS mapping invokes `email-notification.main`, batch size 5 and partial-batch response enabled. Transport normalizer unwraps EventBridge `detail` from SQS body. | UNVERIFIED | `apps/email-service/serverless.yml:306-317`; `libs/event-platform/src/sdk/consumer/transport-normalize.ts:46-55,72-85` |
| 7 | Email processor | Resolve correct template | Consumer recognizes the exact shared schema and maps event type to `VENDOR_EMAIL_VERIFICATION`, but parameter values do not satisfy the repository template placeholders. | MISMATCHED | `apps/email-service/src/modules/email/handlers/email-notification.ts:80-99`; `apps/email-service/src/modules/email/domain/legacy-event-adapter.ts:64-72`; `apps/email-service/src/templates/vendor/VENDOR_EMAIL_VERIFICATION.txt:5-11` |
| 8 | Email provider | Send verification email | SES sender, delivery tracking, retries, and send error propagation are implemented; no evidence an actual message reached SES or was delivered. | UNVERIFIED | `apps/email-service/src/modules/email/services/EmailNotificationProcessor.ts:85-155` |

### Exact publication conditions

The stream handler publishes only when every condition below is true:

1. The record passes Lambda's stream filter: `MODIFY` of a Vendor `PROFILE` item.
2. `newImage.entityType === 'Vendor'` and `newImage.status === 'PENDING_VERIFICATION'`.
3. The new profile is neither email-verified, consumed, nor revoked.
4. The old profile did **not** have all five email-verification sections; the new profile does: `BUSINESS_INFO`, `OWNER_DETAILS`, `ADDRESS`, `BRANCH`, `BANK_DETAILS`.
5. New profile data supplies a valid email, `emailVerificationRequestId`, non-empty first name derived from `contactName`, and non-empty opaque token (`emailVerificationOtp`).

The onboarding service creates the request ID/token on that same five-section transition only if the email is valid, the vendor is not already verified, and no request ID already exists (`apps/vendor-service/src/services/onboarding.service.ts:203-229`). It does **not** require `DOCUMENTS` for this email eligibility. In contrast, onboarding becomes `PENDING_REVIEW` only after all six sections including documents (`apps/vendor-service/src/domain/onboarding.ts:164-200`); `VendorOnboarding.Submitted` is a separate event and is not treated as this event.

It will not publish for inserts/removes, child rows, other profile changes after the five sections are complete, `ACTIVE`/other lifecycle statuses, missing/invalid required fields, a verified/consumed/revoked request, or a stream record filtered by Lambda. A resend uses a direct publisher rather than the stream handler (`apps/vendor-service/src/services/email-verification.service.ts:130-194`).

All three Vendor stream handlers exist: onboarding (`serverless.yml:263-279`), email verification (`:281-310`), and lifecycle (`:312-328`). Only the email-verification mapping has the targeted profile filter; the other two were reviewed as separate handlers.

## C. Event Contract Comparison

| Contract aspect | Publisher | Consumer | Finding |
|---|---|---|---|
| Event type / EventBridge `detail-type` | `VendorEmailVerification.Requested` | Rule and schema expect same | Match |
| Source | `vendor-service` | Rule expects same | Match |
| Bus | `EVENT_BUS_NAME`, rendered as `nvdev-bw-vendor-event-bus` | Imports `nvdev-bw-vendor-event-bus-name` | Match in generated templates; deployed export unverified |
| Version | `1.0.0` | Same shared `VendorEmailVerificationRequestedEvent` schema | Match |
| Envelope | `BaseEvent`: `eventId`, `eventType`, `eventVersion`, `timestamp`, `source`, `idempotencyKey`, `payload`, `meta` | SQS normalizer unwraps EventBridge `detail`; requires same envelope | Match |
| Payload | Required: `vendorId`, `verificationRequestId`, `intent`, `ownerUserId`, `email`, `firstName`, `otp`, `expiryMinutes`, `vendorStatus`; optional `applicationId` | Same shared strict schema | Match |
| Correlation | Publisher copies stream-derived correlation into `meta.correlationId` | Consumer reads payload/envelope meta into command/log context | Match in code |
| Idempotency | `VendorEmailVerification.Requested:<vendorId>:<verificationRequestId>` | Delivery store receives envelope key | Correct per request; stream framework itself is no-op domain idempotency, so at-least-once publishing is possible but Email delivery tracking is the duplicate boundary |
| Template selection | No template name is published | Consumer maps type to `VENDOR_EMAIL_VERIFICATION` | Correct ownership boundary |
| Template variables | Event adapter supplies `{firstName, otp, expiryMinutes}` | Catalog declares exactly those | Internal code matches, but repository template requires `{ownerName, businessName, verificationUrl}` | **Mismatch** |

The EventBridge adapter serializes the entire base envelope into `Detail` and sets `DetailType` from `event.eventType` (`libs/event-platform/src/adapters/eventbridge/eventbridge-put-events.ts:8-17`). The SQS consumer explicitly unwraps the EventBridge event body to its `detail` before schema validation, so there is no envelope-nesting mismatch.

The template validator extracts placeholders from the resolved SES template and rejects missing values (`apps/email-service/src/modules/email/templates/template-parameter-validator.ts:18-64`). Consequently, the template mismatch is a deterministic processing failure—not merely a cosmetic rendering issue. Do not include or log the opaque verification token while diagnosing it.

## D. Identified Gaps

| ID | Severity | Service | Gap | Root cause | Evidence | Recommended fix |
|---|---|---|---|---|---|---|
| G-01 | P0 | Email Service | `VENDOR_EMAIL_VERIFICATION` cannot be rendered from this event contract if the repository template is provisioned to SES. | Adapter passes `firstName`, `otp`, `expiryMinutes`; template placeholders are `ownerName`, `businessName`, `verificationUrl`. No verification URL is present in the event. | Adapter `apps/email-service/src/modules/email/domain/legacy-event-adapter.ts:68-72`; template `apps/email-service/src/templates/vendor/VENDOR_EMAIL_VERIFICATION.txt:5-11`; validator `.../template-parameter-validator.ts:26-64`. | Align one contract: either provision a template using the existing three fields, or extend the event/adapter with the fields needed to safely form a verification URL. Validate the deployed SES template before rollout. |
| G-02 | P0 | Deployment / both services | Local source and generated packages cannot be confirmed as deployed. The staged change switched the template mapping from `vendor_email_confirmation` to `VENDOR_EMAIL_VERIFICATION` and added required log markers. | AWS read APIs are explicitly denied until MFA credentials are used. | `git diff --cached` shows the mapping/log changes; AWS errors recorded in section E. | Deploy the reviewed artifacts through the normal pipeline, then perform the listed read-only runtime checks with MFA-backed credentials. |
| G-03 | P1 | Vendor / frontend integration | Actual frontend completion path is not auditable from this repository. | No frontend source is present. Backend allows the five-section transition, but no browser/API trace proves UI reaches it or preserves `PENDING_VERIFICATION`. | Repository file inventory; backend path `apps/vendor-service/src/services/onboarding.service.ts:203-229,333-398`. | Audit the frontend repository or a sanitized production trace; confirm it saves all five sections and that the final relevant profile update is a Vendor `PROFILE` `MODIFY`. |
| G-04 | P2 | Email Service / tests | Obsolete `vendor_email_confirmation` remains in test fixtures/assertions, though not in current runtime configuration. This can produce misleading tests and stale deployment expectations. | Assertions were not updated with the runtime mapping. | `apps/vendor-service/src/events/vendor-email-verification-infra.spec.ts:33-37`; `libs/event-platform/src/core/contracts/vendor-email-verification.events.spec.ts:74`. | Update/remove stale test-only references when implementing fixes; retain no runtime fallback to the obsolete name. |
| G-05 | P2 | EventBridge / SQS | Queue policy scopes EventBridge only to the account, not to this rule ARN. | `aws:SourceArn` is absent. This does not block current routing, but is broader than necessary. | `apps/email-service/serverless.yml:416-425`. | Restrict with the intended EventBridge rule ARN while preserving cross-stack deployment ordering. |

## E. Deployment Gaps

### Local generated CloudFormation

The current local package artifacts dated 2026-10-09 contain the expected dev configuration:

- Vendor table stream view: `NEW_AND_OLD_IMAGES`.
- Enabled stream mapping `OnVendorEmailVerificationRequestedEventSourceMappingDynamodbVendorTable`, with expected profile/MODIFY filter, retry count 3, failure DLQ, and function `nvdev-bw-vendor-email-verification-stream`.
- Vendor bus `nvdev-bw-vendor-event-bus` and Lambda `EVENT_BUS_NAME` are rendered.
- Email `VendorEmailVerificationRule` is enabled, imports `nvdev-bw-vendor-event-bus-name`, matches the exact source/type, and targets `EmailNotificationQueue`.
- `EmailNotificationQueue` has 180-second visibility timeout, max receive count 5, notification DLQ, and enabled Lambda mapping with partial-batch response.
- Packaged Email Lambda environment contains `VENDOR_EMAIL_CONFIRMATION_TEMPLATE_NAME=VENDOR_EMAIL_VERIFICATION`.

Evidence: `apps/vendor-service/.serverless/cloudformation-template-update-stack.json` resources `VendorTable`, `OnVendorEmailVerificationRequestedEventSourceMappingDynamodbVendorTable`, and `OnVendorEmailVerificationRequestedLambdaFunction`; `apps/email-service/.serverless/cloudformation-template-update-stack.json` resources `VendorEmailVerificationRule`, `EmailNotificationQueue`, `EmailNotificationQueuePolicy`, and `EmailNotificationEventSourceMappingSQSEmailNotificationQueue`.

These are package artifacts, not deployed-resource evidence.

### Attempted AWS runtime verification

Resolved repository defaults: account credentials identify account `542476693486`, region `us-east-1`, stage `dev`; expected names are `nvdev-bw-vendor-event-bus`, `nvdev-bw-vendor-email-verification-stream`, and `nvdev-bw-email-notification`.

`aws sts get-caller-identity` succeeded. Each of the following read-only commands failed with an explicit identity-policy deny from `arn:aws:iam::542476693486:policy/force-mfa`:

- `aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE --region us-east-1 ...` — denied `cloudformation:ListStacks`.
- `aws events describe-event-bus --name nvdev-bw-vendor-event-bus --region us-east-1` — denied `events:DescribeEventBus`.
- `aws lambda get-function --function-name nvdev-bw-vendor-email-verification-stream --region us-east-1 ...` — denied `lambda:GetFunction`.
- `aws lambda get-function --function-name nvdev-bw-email-notification --region us-east-1 ...` — denied `lambda:GetFunction`.

Therefore the deployed stream mapping, rules/targets, queue policy/attributes, Lambda environment/code versions, CloudWatch markers, queue depth/DLQs, SES template, and delivery logs are all **UNVERIFIED**. Required follow-up read-only commands after MFA include `lambda list-event-source-mappings`, `events describe-rule`/`list-targets-by-rule`, `sqs get-queue-attributes`, `sesv2 get-email-template`, CloudWatch Logs Insights queries for the markers below, and SQS `get-queue-attributes` for visible/not-visible/DLQ counts.

## F. Recommended Fix Plan

1. Resolve G-01 first: choose and implement one verification-email parameter contract, including a safe verification URL strategy. Confirm the stored SES `VENDOR_EMAIL_VERIFICATION` template uses exactly that contract.
2. Update tests and stale `vendor_email_confirmation` references so packaged/deployed expectations agree with runtime configuration.
3. Deploy the already-reviewed Vendor and Email Service changes together through the normal pipeline; do not add new queues, handlers, or EventBridge infrastructure.
4. With MFA-backed read-only access, verify deployed Lambda code/environment, DynamoDB mapping/filter, bus/rule/target, queue policy/mapping/attributes, template content, and recent logs/queue/DLQ metrics.
5. Audit the frontend repository or collect a sanitized trace to prove it reaches the five-section transition. Verify with a non-production/sanitized workflow only after the contract is fixed; do not expose bearer tokens.
6. Optionally harden the queue policy with the verification rule's source ARN.

## G. Final Verdict

**PARTIALLY WIRED — GAPS IDENTIFIED**

The repository and generated CloudFormation show a coherent Vendor DynamoDB Stream → vendor EventBridge bus → exact EventBridge rule → EmailNotificationQueue → Email SQS consumer route. The publisher and consumer share the event schema, source, type, version, envelope, correlation handling, and per-request idempotency key. However, the current named-template variables are incompatible with the delivered command, making email dispatch fail when that template is deployed, and neither the local staged implementation nor any AWS runtime resource/log/delivery state could be verified because read-only AWS access is blocked by MFA enforcement.

### Observability assessment

The requested markers exist in the local/staged code at the correct boundaries:

- Vendor: `vendor_stream_record_received` (`map-vendor-email-verification-requested-stream.ts:81-87`), `vendor_email_event_publish_started`, `vendor_email_event_publish_succeeded`, `vendor_email_event_publish_failed` (`vendor-email-verification-stream.ts:54-61`).
- Email: `email_event_received`, `email_event_matched` (`email-notification.ts:91-92`), `email_template_resolved`, `email_send_started`, `email_send_succeeded`, `email_send_failed` (`EmailNotificationProcessor.ts:60-63,97-100,128-154`).

`vendorId`, `eventId`, and `correlationId` are carried/logged across the published envelope and consumer. `verificationRequestId` is in the event payload/idempotency key but is **not** added to the requested vendor or email log fields; this is an observability gap for request-level tracing. EventBridge/SQS preserve the envelope inside EventBridge `detail`, but the Email logs do not include `verificationRequestId`. No token is included in the identified log fields.
