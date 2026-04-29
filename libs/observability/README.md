Here’s your **final, production-ready README** aligned with the **auto-init + optional override architecture** 👇

---

# @myvitalrx/observability

**Enterprise-grade observability SDK for Node.js & AWS Lambda**

A lightweight, production-ready library providing:

* Structured logging (built on Powertools)
* Automatic context propagation (correlationId, request scope)
* Log level + sampling control (CloudWatch cost optimization)
* PII protection & log policy enforcement
* Metrics (EMF)
  

# Why This Library Exists

In distributed systems:

* Logs become noisy → **high CloudWatch cost**
* No correlation → **hard debugging**
* Payload logging → **PII/security risks**
* Inconsistent logs → **no observability standard**

---

## This SDK Solves

| Problem            | Solution              |
| ------------------ | --------------------- |
| Log explosion      | Sampling + log levels |
| No tracing         | Correlation ID        |
| PII leakage        | Automatic redaction   |
| Inconsistent logs  | Enforced structure    |
| Developer friction | Zero-config usage     |

---

#   Installation

```bash
pnpm add @myvitalrx/observability
```

---

#  Zero-Config Usage (Auto Initialization)


The library **automatically initializes on first use** using:

```text
override > environment variables > safe defaults
```

---

## Basic Usage

```ts
import { getLogger } from '@myvitalrx/observability';

const logger = getLogger();

logger.info('app_started', {
  message: 'Application initialized',
});
```

---

# Configuration

##   Environment Variables (Recommended)

```bash
SERVICE_NAME=sms-service
LOG_LEVEL=INFO
LOG_SAMPLE_INFO=0.1
LOG_SAMPLE_DEBUG=0.01
REDACT_PII=true
METRICS_NAMESPACE=ApiHub
```

---

## Optional Override (Advanced)

```ts
import { configureObservability } from '@myvitalrx/observability';

configureObservability({
  serviceName: 'sms-service',
  logLevel: 'DEBUG',
  sampling: { debug: 1 },
});
```

---

## Important Rule

```ts
// Correct
configureObservability(...);
const logger = getLogger();

// Wrong
const logger = getLogger();
configureObservability(...); // too late
```

---

# Logging

## Standard Usage

```ts
const logger = getLogger();

logger.info('sms_sent', {
  message: 'SMS delivered',
  provider: 'aws',
});
```

---

## Log Structure (Enforced)

```ts
{
  event: string,
  message?: string,
  ...metadata
}
```

* `event` is mandatory (auto-filled if missing)
* Policy violations are sanitized automatically

---

## Child Logger

```ts
const logger = getLogger({ tenantId: 'org-123' });

logger.info('tenant_action');
```

---

# 🔁 Context Propagation

## Lambda Wrapper (Recommended)

```ts
import { withLambdaObservability } from '@myvitalrx/observability';

export const handler = withLambdaObservability(async () => {
  const logger = getLogger();

  logger.info('handler_started');
});
```

---

## Injected Context

* `correlationId`
* `awsRequestId`
* `functionName`

---

## Manual Context

```ts
import { withContext } from '@myvitalrx/observability';

await withContext({ correlationId: 'abc-123' }, async () => {
  const logger = getLogger();
  logger.info('inside_context');
});
```

---

# Correlation ID Strategy

Priority order:

```text
1. x-correlation-id (client)
2. SQS / EventBridge propagation
3. awsRequestId
4. Generated UUID
```

---

# Log Levels

Controlled via:

```bash
LOG_LEVEL=INFO
```

---

## Behavior

| Level | Logs Included       |
| ----- | ------------------- |
| ERROR | ERROR               |
| WARN  | WARN + ERROR        |
| INFO  | INFO + WARN + ERROR |
| DEBUG | ALL                 |

 Handled internally by Powertools

---

#  Sampling (Cost Optimization)

```bash
LOG_SAMPLE_INFO=0.1
LOG_SAMPLE_DEBUG=0.01
```

---

## Behavior

* ERROR / WARN → always logged
* INFO / DEBUG → sampled

---

#  PII Protection & Log Policy

Enabled by default.

---

## Automatically Blocked Fields

```ts
request → "[BLOCKED]"
response → "[BLOCKED]"
headers → "[BLOCKED]"
body → "[BLOCKED]"
```

---

## Additional Protection

* Emails masked
* Phone numbers masked
* Tokens removed
* JWTs redacted

---

# Controlled Logging (Recommended)

## HTTP

```ts
logHttpRequest(logger, {
  method: 'POST',
  path: '/send-sms',
  statusCode: 200,
  durationMs: 120,
});
```

---

## External Calls

```ts
logExternalCall(logger, {
  target: 'sms-provider',
  operation: 'sendSms',
  durationMs: 85,
});
```

---

## Database

```ts
logDbQuery(logger, {
  operation: 'INSERT',
  resource: 'users',
  durationMs: 20,
});
```

---

# 📊 Metrics (EMF)

```ts
import { recordConsumerEventProcessed } from '@myvitalrx/observability';

recordConsumerEventProcessed({
  status: 'SUCCESS',
});
```

* Uses Powertools EMF
* No global state

---

# Cost Optimization Strategy

## Recommended Production Setup

```bash
LOG_LEVEL=ERROR
LOG_SAMPLE_INFO=0.05
```

---

## Best Practices

* Use `ERROR` or `WARN` in production
* Avoid DEBUG in hot paths
* Use sampling for high-volume APIs
* Log summaries, not payloads

---

# What NOT To Do

## Avoid console logs

```ts
console.log('debug'); // ❌
```

---

## Do NOT log full payloads

```ts
logger.info('request', {
  request: event, // blocked
});
```

---

## Do NOT log sensitive data

* passwords
* tokens
* JWT
* headers

---

## Do NOT pass logger manually

```ts
service.doWork(logger); // ❌
```

---

## Do NOT create logger globally

```ts
const logger = getLogger(); // ❌
```

---

# Recommended Pattern

```text
Middleware → Context → Logger → Structured Logs
```

---

# 🏢 Enterprise Benefits

## 📈 Observability

* Standard logs across services
* Easy debugging
* End-to-end traceability

---

## Cost Control

* Reduced CloudWatch usage
* Sampling-based logging
* No redundant logs

---

## Security & Compliance

* PII masking
* No accidental leaks
* Audit-safe logs

---

## Developer Experience

* Zero setup
* Minimal boilerplate
* Works across services

---

# Architecture Philosophy

> **Auto-initialization + enforced standards + minimal developer effort**

---

# 🏁 Summary

This SDK ensures:

* Clean logs
* Safe logs
* Scalable observability
* Low operational cost

---
 