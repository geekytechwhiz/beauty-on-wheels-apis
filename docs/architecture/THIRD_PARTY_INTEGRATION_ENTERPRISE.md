# Third-Party Integration: Enterprise-Level Approach

Best practices for integrating external partners (labs, insurers, hospitals, etc.) in the API Hub platform. Aligns with existing patterns in `lab-webhook-ingestion`, `partner-registry`, and `libs/partners`.

---

## 1. Architecture Principles

### 1.1 Single Integration Boundary (Adapter Layer)

- **One place** for each partner’s protocol: auth, payload shape, retries, and errors.
- **Canonical internal model**: partner-specific formats are normalized at the boundary; the rest of the platform works only with canonical types (e.g. `CanonicalLabEvent`, `@api-hub/integration-events`).
- **Partner Registry as source of truth**: partner config, capabilities, endpoints, and secrets come from Partner Registry; adapters are keyed by `partnerId` and use registry for runtime config.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        API Hub (your platform)                          │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │ API /       │───▶│ Integration      │───▶│ Domain services     │   │
│  │ Webhook     │    │ (Adapter layer)   │    │ (Lab, Order, etc.)  │   │
│  │ entry       │    │ • Auth per partner│    │ • Canonical only    │   │
│  └─────────────┘    │ • Parse → canon.  │    └─────────────────────┘   │
│                     │ • Partner Registry│                               │
│                     └──────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐           ┌─────────────────┐
│ Partner A       │           │ Partner B       │
│ (e.g. Redcliffe)│           │ (e.g. Orange)   │
└─────────────────┘           └─────────────────┘
```

### 1.2 Separation of Concerns

| Layer | Responsibility | In this repo |
|-------|----------------|--------------|
| **Entry** | Routing, rate limit, TLS, correlation ID | API Gateway / `lab-webhook-ingestion` HTTP handler |
| **Adapter** | Partner-specific auth, parse, validate, map to canonical | `adapters/*.webhook.ts`, `webhookAdapter.factory` |
| **Canonical** | Shared event/request types | `libs/integration-events`, `models/canonicalEvent` |
| **Registry** | Partner config, capabilities, secrets | `partner-registry`, `libs/partners`, `partnerRegistry.client` |
| **Domain** | Business logic, persistence | Lab Domain (external), order-service, etc. |

Keep “call third-party API” vs “receive third-party webhook” clearly separated; each can have its own adapter type (e.g. `LabWebhookAdapter` vs future `LabOutboundAdapter`).

---

## 2. Recommended Patterns (What You Already Have + Gaps)

### 2.1 Adapter Pattern ✅ (in place)

- **Interface per integration type** (e.g. `LabWebhookAdapter`: `authenticate`, `parseEvent`, `getEventId`).
- **Factory** resolves adapter by `partnerId` (e.g. `getWebhookAdapter(partnerId)`); throw `UnknownPartnerError` for unknown partners.
- **Registry first**: resolve partner from Partner Registry before choosing adapter; use registry for status (e.g. only `ACTIVE`) and endpoint URLs.

**Recommendation:** Move from switch/factory to **registry-driven adapter registration** when partner count grows (e.g. adapter type/capability in registry so new partners don’t require code changes for known types).

### 2.2 Canonical Model ✅ (in place)

- **Shared libs** for canonical types (`integration-events`, canonical event types).
- Adapters **only** produce/consume canonical DTOs; domain and other services never see raw partner payloads.

**Recommendation:** Version canonical schemas (e.g. `CanonicalLabEventV1`) and support at least one previous version for backward compatibility during partner rollouts.

### 2.3 Security

- **Auth per partner**: webhook signature + timestamp (and replay window); use **secrets from Partner Registry**, not env vars per partner.
- **Validate signature** before parsing body; fail fast with `InvalidSignatureError`.
- **No PII in logs**; log `partnerId`, `eventType`, `eventId`, correlation ID only.
- **TLS only** for all outbound calls to partners; certificate validation on.

**Gap to close:** Implement real signature verification and replay-window check (see `redcliffe.webhook.ts` TODO). Store webhook secret in Partner Registry and fetch per request or cache with TTL.

### 2.4 Idempotency ✅ (pattern in place)

- Use composite key e.g. `partnerId:eventId` (or `partnerId:requestId` for outbound).
- **Persistent store** (DynamoDB or cache with TTL) instead of in-memory; in-memory is only for dev.

**Recommendation:** Add TTL on idempotency keys (e.g. 24–72 hours) and define behavior for duplicate (return 200 with same result, not 4xx).

### 2.5 Resilience (Outbound to Third Parties)

- **Timeouts**: always set (e.g. 10–15 s for webhook forward, 30 s for outbound API).
- **Retries**: exponential backoff with max attempts (e.g. 3); retry only on 5xx and network errors, not 4xx.
- **Circuit breaker**: per partner (or per endpoint) to avoid cascading failures; open after N failures, half-open after cooldown.
- **Fallback**: where applicable (e.g. return cached or “pending” instead of calling partner when circuit is open).

**Recommendation:** Use a small shared client lib for “call partner HTTP” that enforces timeout, retries, circuit breaker, and structured logging.

### 2.6 Observability

- **Structured logging**: one log line per integration call with `partnerId`, `eventType`/operation, `durationMs`, `status`, `correlationId`; no raw payloads.
- **Metrics**: count and latency per partner (and per operation if needed); alert on error rate and latency SLO.
- **Tracing**: propagate correlation ID from gateway through adapter to domain and to partner outbound calls; use same ID in logs and traces.
- **Audit**: log security-relevant events (auth failure, unknown partner, duplicate, circuit open) for compliance.

### 2.7 Versioning and Compatibility

- **Partner API version**: support via config (e.g. in Partner Registry: `version: "v2"`) so adapter can switch behavior without new deployment for that partner only.
- **Canonical schema**: support at least current + previous major version; deprecation window (e.g. 6 months) before removing old format.
- **Webhook path**: keep path stable; use `partnerId` (and optional `version` query/header) for routing; avoid partner-specific paths in URL.

### 2.8 Rate Limiting and Quotas

- **Inbound**: global and per-partner rate limits at API Gateway or entry Lambda to protect downstream.
- **Outbound**: per-partner quota and throttling so one partner cannot consume all capacity; queue (e.g. SQS) for non-real-time outbound calls.

### 2.9 Configuration and Secrets

- **Partner Registry** holds: endpoints, capability (e.g. FHIR vs NON_FHIR), status, and **references** to secrets (e.g. secret name/ARN).
- **Secrets Manager / SSM**: store webhook secrets, API keys; resolve by partner at runtime; rotate without code change.
- **Feature flags** per partner or per capability for gradual rollout and kill switch.

---

## 3. Service Layout (How to Split)

### 3.1 Lab Integration Service 

| Aspect | Description |
|--------|--------------|
| **Purpose** | Call external lab APIs (Redcliffe, Orange). Synchronous, request/response. Partner-specific adapters. Low latency, controlled traffic. |
| **Characteristics** | Stateless. Triggered by domain workflows. Internal-only. Predictable load. |
| **Inbound** | Webhooks from partners (`POST /webhooks/labs/{partnerId}`) → canonical → EventBridge + optional Lab Domain. |
| **Outbound** | Domain workflows call `POST /internal/labs/partners/{partnerId}/call` (operation + body) → adapter builds request → call partner API → return response. |

### 3.2 WebSocket / Real-time Notification (removed)

The WebSocket / realtime-gateway service has been **removed** from the codebase. Real-time UI push is out of scope; third-party event integration uses webhooks (inbound/outbound) only.

### 3.3 Summary

- **Lab Integration**: one service for both inbound webhooks and outbound partner API calls; stateless, sync, internal-only, predictable.
- **Partner Registry**: shared; config and endpoints.

---

## 4. Checklist for Adding a New Partner

1. **Partner Registry**: create partner, set status `ACTIVE`, endpoints, capability, secret reference.
2. **Adapter**: implement interface (e.g. `LabWebhookAdapter`); add to factory or registry-driven map keyed by `partnerId` (and optionally `version`).
3. **Tests**: unit tests for parse/auth (with sample payloads); integration test with stub partner that returns known payload.
4. **Secrets**: create secret for webhook/API key; grant integration service read access; reference in registry.
5. **Docs**: document partner-specific payload shape and auth (internal only); add runbook for “partner down” and circuit breaker.
6. **Observability**: confirm logs and metrics include `partnerId` and correlation ID; set alerts on error rate and latency.

---

## 5. Summary

| Area | Best approach |
|------|----------------|
| **Boundary** | Single adapter layer; canonical model inside platform. |
| **Config** | Partner Registry + secrets store; no partner-specific env vars. |
| **Resilience** | Timeouts, retries, circuit breaker, idempotency with TTL. |
| **Security** | Per-partner auth (signature + replay); no PII in logs. |
| **Observability** | Structured logs, metrics per partner, tracing with correlation ID. |
| **Versioning** | Canonical schema versioning; partner API version in registry. |
| **Services** | One integration service per direction/type. (WebSocket/realtime service removed.) |

This gives you a consistent, scalable, and maintainable approach to third-party integration at enterprise scale while building on the patterns already used in `lab-webhook-ingestion` and Partner Registry.
