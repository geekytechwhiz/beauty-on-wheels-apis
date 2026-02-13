# Partner Registration & Third-Party Auth – Gap Analysis

Review of **partner-registry**, **partner-integration**, **libs/partners**, and related flows. Identifies what is missing for:

> **Note:** The **realtime-gateway** (WebSocket) service has been removed from the codebase. Inbound real-time UI push is out of scope; third-party event integration uses webhooks (inbound/outbound) only. Sections below that reference realtime-gateway are kept for historical context.

1. **Complete partner registration**
2. **Connecting to third parties with their auth mechanism**

---

## 1. Complete Partner Registration

### 1.1 What Exists Today

| Component | Location | Purpose |
|-----------|----------|---------|
| Create partner | `partner-registry`: POST /partner | Create partner with org details, endpoints (type + url), status, onboarding. PartnerId = ULID (server-generated). |
| Update partner | `partner-registry`: PATCH /partner/{id} | Update profile, status, endpoints. |
| Get partner | `partner-registry`: GET /partner/{id} | Read partner config. |
| Set capability | `partner-registry`: PUT /partner/{id}/capability | Set interopMode (FHIR \| NON_FHIR), version. |
| Link org–partner | `partner-registry`: POST /organization/{orgId}/partner | Link org to partner (body: partnerId, optional relationshipType). |
| List org partners | `partner-registry`: GET /organization/{orgId}/partners | List partners linked to org. |
| Shared types | `libs/partners` | Partner, PartnerEndpoint, PartnerCapability, PartnerStatus, OnboardingInfo. |
| Registry model | `partner-registry` repository | DynamoDB: partner meta (pk=PARTNER#id, sk=META), capability (sk=CAPABILITY), org links (pk=ORG#orgId, sk=PARTNER#partnerId). |

**Registration flow that works today:** Create partner → (optional) Update endpoints/capability → Link org to partner. No explicit “approve” step; status can be set on create/update.

### 1.2 Gaps for “Complete” Partner Registration

| # | Gap | Description | Where to fix |
|---|-----|-------------|--------------|
| **G1** | **No credential / auth config in registry** | Partner record has `endpoints[]` (type, url, description) but **no auth type** (Bearer, X-API-Key, OAuth, etc.) and **no reference to credentials** (secret ARN, SSM path). Lab-integration today resolves API keys via **env vars by partner name** (e.g. REDCLIFFE_API_KEY_SECRET_ARN, ORANGE_API_KEY). Adding a new partner (e.g. “acme-lab”) requires new env vars and deployment; registry cannot drive “where to get secret for this partner.” | **libs/partners**: Extend `PartnerEndpoint` or add partner-level `authConfig` (e.g. authType, secretArnOrName). **partner-registry**: Add fields to create/update schema and repository; optional GET endpoint to resolve secret reference only (no secret value). |
| **G2** | **No explicit approve/reject workflow** | `OnboardingInfo` (submittedAt, approvedAt, approvedBy, rejectionReason) and `PartnerStatus` (PENDING_APPROVAL, ACTIVE, REJECTED, …) exist, but there is **no dedicated API** to approve or reject a partner (e.g. POST /partner/{id}/approve, POST /partner/{id}/reject). Status can only be changed via PATCH /partner/{id} with a new status. | **partner-registry**: Add handlers (e.g. approvePartner, rejectPartner) that validate current status, set onboarding fields, set status to ACTIVE/REJECTED, and optionally emit audit/event. |
| **G3** | **Consumers don’t enforce ACTIVE** | Lab-integration (and any other consumer) fetches partner from registry but **does not check** `partner.status === 'ACTIVE'`. So PENDING_APPROVAL or SUSPENDED partners can still be used. | **partner-integration** (partnerRegistry.client): After GET partner, if `partner.status !== 'ACTIVE'`, throw PartnerUnavailableError (or similar). **libs/partners** or doc: Define when “active” is required (e.g. outbound calls only for ACTIVE). |
| **G4** | **No partner-type or integration-type in registry** | Adapter selection (e.g. Redcliffe vs Orange) is **hardcoded by partnerId** in partner-integration’s factory. Registry does not store “this partner is a lab partner” or “adapter type: redcliffe.” Adding a new lab partner requires code change (new adapter + factory branch). | **libs/partners** / **partner-registry**: Optional field e.g. `partnerType` or `integrationType` / `adapterKey` (e.g. "lab", "redcliffe", "orange"). **partner-integration**: Factory could resolve adapter from registry (adapterKey) + allowlist, so new partners of known types don’t require code deploy. |
| **G5** | **Link org–partner: no authz** | POST /organization/{orgId}/partner is **unprotected** (no auth in serverless.yml). Any caller can link any org to any partner. | **partner-registry**: Add API Gateway authorizer (e.g. JWT/Cognito) and/or internal-only (VPC, IAM, or API key); document as internal/admin. |
| **G6** | **Create/Update partner: no authz** | Same as G5: create/update/setCapability have no authorizer. | Same as G5. |

---

## 2. Connect to Third Party with Their Auth Mechanism

Two directions:

- **Outbound:** We call the third party (e.g. lab APIs) — their auth (API key, OAuth, etc.).
- **Inbound:** Third party calls us (e.g. WebSocket, webhooks) — we verify their auth.

### 2.1 Outbound (We Call Partner) – e.g. partner-integration

**What exists:**

- **partner-integration** adapters (Redcliffe, Orange) call partner APIs with:
  - **Auth:** API key from Secrets Manager (env: REDCLIFFE_API_KEY_SECRET_ARN, ORANGE_API_KEY_SECRET_ARN) or fallback env (REDCLIFFE_API_KEY, ORANGE_API_KEY).
  - **Header shape:** Redcliffe = Bearer; Orange = X-API-Key (hardcoded per adapter).
- **partnerRegistry.client** gets partner from registry and uses first `endpoints[type===API].url` as base URL.

**Gaps:**

| # | Gap | Description | Where to fix |
|---|-----|-------------|--------------|
| **A1** | **Auth not registry-driven** | Auth type and credential reference are **not** in Partner Registry. They are in adapter code + env vars. So “their auth mechanism” is fixed per adapter, not per partner config. | Add auth config to registry (G1). Lab-integration (or shared client): resolve auth type + secret reference from registry; apply header (Bearer, X-API-Key, OAuth client_credentials) generically. |
| **A2** | **Only API-key style auth** | Only API key in header is implemented. No **OAuth 2.0 client_credentials** (or similar) for partners that require token-based auth. | Add authType (e.g. API_KEY, BEARER, OAUTH_CLIENT_CREDENTIALS) to registry. In adapter or shared client: if OAUTH_CLIENT_CREDENTIALS, fetch token (client_id/client_secret from secret) then use Bearer; cache token with TTL. |
| **A3** | **Secret reference by partnerId** | Today secret ARN is inferred from **env var name** (e.g. REDCLIFFE_API_KEY_SECRET_ARN). There is no **per-partner secret reference** in registry, so new partners need new env and redeploy. | Store in registry e.g. `apiKeySecretArn` or `credentialsSecretArn` (and optionally authType). Lab-integration (or partnerAuth util): take partnerId + registry payload, resolve secret by ARN from registry; no env per partner. |
| **A4** | **No mutual TLS / client certs** | If a partner requires mTLS, there is no support (no client cert in registry or in adapter). | Optional: registry field for client cert secret ARN; HTTP client in adapters (or shared lib) to attach client cert for that partner. |

### 2.2 Inbound (Partner Calls Us) – e.g. webhooks

**What existed (removed):** The **realtime-gateway** WebSocket service was removed. It had provided:
  - **Auth:** Query params (token, authType). **auth.registry** resolves provider by authType (default jwt).
  - **Providers:** JWT (verify with JWT_SECRET or JWKS; decode-only if neither set), OAuth (introspection via INTROSPECTION_URL + optional client id/secret).
  - Result: **user/org context** (userId, orgId, roles), not “partner” identity.
- **Today:** Inbound third-party integration is via **webhooks** only (when implemented). No WebSocket service in the codebase.

**Gaps:**

| # | Gap | Description | Where to fix |
|---|-----|-------------|--------------|
| **B1** | **No partner identity on connect** | WebSocket auth yields userId/orgId/roles, not partnerId. So we cannot enforce “only partner X can subscribe to topic Y” or rate-limit by partner. | Optional: New auth provider (e.g. authType=partner_api_key) that validates API key against Partner Registry (or secret); returns context with partnerId (and optionally orgId if linked). |
| **B2** | **Webhook auth not in registry** | Doc (THIRD_PARTY_INTEGRATION_ENTERPRISE.md) says webhook secret should be in registry and validated per request. Lab-webhook-ingestion was removed; any future webhook service would need **per-partner webhook secret** (and replay/signature) from registry. | When (re)introducing webhooks: store webhook secret reference (and auth type: signature, replay window) in partner registry; adapter fetches and validates. |
| **B3** | **OAuth provider: JWKS not implemented** | (Historical: realtime-gateway JWT provider had decode-only when only JWKS was set. Service removed.) | N/A — WebSocket service removed. |

---

## 3. Summary Tables

### 3.1 Partner Registration – Missing for “Complete”

| Item | Status | Action |
|------|--------|--------|
| Create/update partner with endpoints | Done | — |
| Set capability (FHIR/NON_FHIR) | Done | — |
| Link org to partner | Done | — |
| **Store auth type + credential reference in registry** | Missing | G1, A3 |
| **Explicit approve/reject API** | Missing | G2 |
| **Enforce ACTIVE when using partner (e.g. partner-integration)** | Missing | G3 |
| **Partner type / adapter key in registry** | Missing | G4 (optional) |
| **Authz on partner-registry APIs** | Missing | G5, G6 |

### 3.2 Third-Party Auth – Missing for “Connect with Their Auth”

| Direction | Item | Status | Action |
|-----------|------|--------|--------|
| **Outbound** | API key from env/Secrets per partner | Done (env-driven) | — |
| **Outbound** | Auth type + secret reference in registry | Missing | A1, A3 |
| **Outbound** | OAuth client_credentials for partners | Missing | A2 |
| **Outbound** | mTLS / client certs | Missing | A4 (optional) |
| **Inbound** | JWT + OAuth introspection (realtime) | Removed (realtime-gateway deleted) | — |
| **Inbound** | JWKS verification for JWT | Missing | B3 |
| **Inbound** | Partner-scoped auth (e.g. API key → partnerId) | Missing | B1 |
| **Inbound** | Webhook secret in registry | Missing | B2 (when webhooks return) |

---

## 4. Recommended Order of Work

1. **Registry auth config (G1, A1, A3):** Add optional `authType` and credential reference (e.g. `apiKeySecretArn`) to partner/endpoint in libs/partners and partner-registry. Lab-integration (or shared client) resolves key from registry-driven ARN so new partners don’t require new env vars.
2. **Enforce ACTIVE (G3):** In partnerRegistry.client (and any other consumer), reject non-ACTIVE partners with a clear error.
3. **Approve/reject API (G2):** Add approve/reject handlers in partner-registry and use onboarding + status.
4. **Authz on partner-registry (G5, G6):** Add authorizer so only allowed callers can create/update/link.
5. **Inbound partner auth (B1) and webhook secret in registry (B2):** When product needs “partner calls us” with partner identity or webhooks.
6. **OAuth for outbound (A2), JWKS for inbound (B3):** As needed by partners or security policy.

This keeps the current flows working while closing the main gaps for complete registration and registry-driven third-party auth.
