# Master Implementation Plan
## Complete Partner Integration Implementation Guide

**Purpose:** This is the master implementation plan consolidating all partner integration requirements for Redcliffe and Orange partners. Use this document as the single source of truth for implementation.

**Last Updated:** Consolidated from 4 reference documents  
**Status:** Ready for Implementation

---

## 📚 External References

**Note:** This document consolidates all information from previous guides. All implementation details are included in this master plan.

**External References:**
- Redcliffe Postman Collection: https://api.postman.com/collections/25836147-c45099eb-2f45-4e29-8a0f-d8da1e36c889
- Redcliffe API documentation: https://docs.google.com/document/d/1aXpnbanPV8jDVXok7pp-a3_LmsUYLcWQJbqO7IcBJh4/edit?tab=t.p68vd7si2ak5#heading=h.rezsv2g3r6vz
- Orange Health API Docs: https://orangehealth.docs.apiary.io/


---

## 🎯 Implementation Overview

### Core Operations (4)
1. **createOrder** - POST data to create new order
2. **rescheduleOrder** - UPDATE data to reschedule existing order
3. **cancelOrder** - UPDATE data to cancel existing order
4. **getOrderStatus** - GET data to retrieve order status

### Additional APIs (10+)
- Location & Service Discovery (2 APIs)
- Package Discovery (2 APIs)
- Booking Management (3 APIs)
- Time Slots (1 API)
- Reports (2 APIs)

**Total APIs to Implement:** 14 APIs per partner (28 total, excluding OTP which is not required)

---

## 📊 Implementation Priority

### Phase 0: Architectural Foundation (Do First)
**Priority:** 🔵 **FOUNDATION**  
**Timeline:** Before or in parallel with Week 1

- **Reusability:** Base order command + partner extensions; separate Zod schemas per adapter; validate per partner.
- **Standards:** Idempotency for create/reschedule/cancel; retry/backoff; optional circuit breaker; document or generate partner request/response contracts.
- **Scalability:** Adapter factory refactored to registry (adapterKey → constructor); new partners without editing factory; document registry SLA and caching if used.
- **Patterns:** Shared base adapter with getAuthHeaders, request, error handling; reduce duplication and standardize resilience across adapters.

**See section "PHASE 0: ARCHITECTURAL FOUNDATION" for full steps.**

### Phase 1: Critical (Must Have) - Start Here
**Priority:** 🔴 **CRITICAL**  
**Timeline:** Week 1-2  
**Status:** ✅ **COMPLETE - READY FOR PHASE 2**

1. ✅ **Create Order** (both partners) - **COMPLETE**
   - Redcliffe: ✅ Fully implemented with `key` header, endpoint `/api/external/v2/center-create-booking/`
   - Orange: ✅ Fully implemented with `api_key` header, endpoint `/lab/orders`

2. ✅ **Reschedule Order** (both partners) - **COMPLETE**
   - Redcliffe: ✅ Fully implemented, endpoint `/api/external/v2/center-update-booking/`
   - Orange: ✅ Fully implemented, endpoint `/lab/orders/{orderId}/reschedule`

3. ✅ **Cancel Order** (both partners) - **COMPLETE**
   - Redcliffe: ✅ Fully implemented, endpoint `/api/external/v2/center-update-booking/`
   - Orange: ✅ Fully implemented, endpoint `/lab/orders/{orderId}/cancel`

4. ✅ **Get Order Status** (both partners) - **COMPLETE**
   - Redcliffe: ✅ Fully implemented, endpoint `/api/external/v2/center-get-booking` (GET with query param)
   - Orange: ✅ Fully implemented, endpoint `/lab/orders/{orderId}/status` (GET)

**All Phase 1 APIs are fully implemented, following consistent patterns, and ready for testing.**

### Phase 2: High Priority (Should Have)
**Priority:** 🟠 **HIGH**  
**Timeline:** Week 3-4

5. Get Serviceable Locations (both partners)
6. Get Partner Location (both partners)
7. Search Packages (both partners)
8. Get Package Details (both partners)
9. Get Booking Slots (both partners)

### Phase 3: Medium Priority (Nice to Have)
**Priority:** 🟡 **MEDIUM**  
**Timeline:** Week 5-6

10. Confirm Booking/Order (both partners)
11. Update Package (both partners)
12. Get Consolidated Report (both partners)
13. Get Digital Report (both partners)

### Phase 4: Low Priority (Future)
**Priority:** 🟢 **LOW**  
**Timeline:** Future

14. Update Credit (both partners)
15. Webhooks (both partners - check later)

---

## 🏗️ PHASE 0: ARCHITECTURAL FOUNDATION (Do First)

**Priority:** 🔵 **FOUNDATION**  
**Timeline:** Before or in parallel with Week 1  
**Purpose:** Implement the four mandatory architectural steps (Reusability, Standards, Scalability, Patterns) so Phase 1+ builds on a solid base.

---

### Step 1 – Reusability: Base order command, partner extensions, per-partner validation

**Goal:** Define a **base order command** and **partner-specific extensions** (or **separate Zod schemas per adapter**) and **validate per partner**.

- **Base command:** In `src/models/order.command.ts`, define `BaseCreateOrderCommand` with only canonical fields (partnerId, patientId, testCodes, etc.). No partner-specific fields in the base.
- **Partner extensions:** Define `RedcliffeCreateOrderExtension`, `OrangeCreateOrderExtension`, etc. Type `CreateOrderCommand = BaseCreateOrderCommand & (RedcliffeCreateOrderExtension | OrangeCreateOrderExtension)` (or equivalent).
- **Separate Zod schemas per adapter:** Refactor validation into e.g. `src/validation/createOrder/base.createOrder.schema.ts`, `redcliffe.createOrder.schema.ts`, `orange.createOrder.schema.ts`. Export `getCreateOrderSchema(partnerId)` that returns the schema for that partner.
- **Validate per partner:** Handlers resolve `partnerId` first (from body or path), then call `getCreateOrderSchema(partnerId).safeParse(body)` so each partner gets its own required/optional rules.

**Checklist:** Base command only canonical fields; partner extensions in separate types; per-partner Zod schemas; `getCreateOrderSchema(partnerId)`; handler validates after partnerId is known.

---

### Step 2 – Standards: Idempotency, retry/backoff, circuit breaker, partner contracts

**Goal:** Add **idempotency** for create/reschedule/cancel; define **retry/backoff** and **optional circuit breaker**; **document (or generate) partner request/response contracts**.

- **Idempotency:** For create, reschedule, and cancel: client sends `Idempotency-Key` header. Handler reads it and passes to the integration service. Either (A) store key → result (e.g. DynamoDB/cache, TTL e.g. 24h) and return cached result on duplicate key, or (B) forward key to partner when supported. Document which approach is used.
- **Retry with backoff:** Use a single HTTP wrapper (e.g. axios-retry or custom `requestWithRetry`) for partner calls. Config: max retries (e.g. 2–3), backoff (exponential/linear), only for retryable errors (5xx, 408, 429, network). Do not retry non-retryable 4xx. Place in base adapter (Step 4) so all adapters get it.
- **Optional circuit breaker:** Use a library (e.g. opossum) or small in-memory circuit breaker around partner HTTP. Config: failure threshold, reset timeout. Place in base adapter’s `request()`. Optionally per-partner (by partnerId). Document: enabled by config/env and defaults.
- **Partner request/response contracts:** For each partner and operation (create, reschedule, cancel, getStatus): document request (URL, method, headers, body/query shape) and response (success/error body, status codes). Store in e.g. `docs/partner-contracts/`. Optionally generate TS types (e.g. from OpenAPI) and use in adapters.

**Checklist:** Idempotency for create/reschedule/cancel; retry/backoff on partner HTTP; optional circuit breaker; partner contracts documented (and optionally generated).

---

### Step 3 – Scalability: Adapter registry (adapterKey → constructor), registry SLA and caching

**Goal:** **Refactor adapter factory to a registry** (adapterKey → constructor) so **new partner types can be added without editing the factory**; **document registry SLA and caching if used**.

- **Adapter registry:** Replace hardcoded `if (key === 'redcliffe') return new RedcliffeAdapter(config)` with a registry: a map from `adapterKey` (string) to adapter constructor. New partner type = add one registry entry (e.g. in `src/adapters/adapter.registry.ts`); no change to `getAdapter()` branching logic. Factory: resolve adapterKey from config, call `getAdapterConstructor(key)`, then `new Ctor(config)`.
- **Document registry SLA:** Document that partner config (including adapterKey) comes from the Partner Registry service; document expected SLA (latency, availability) and that the integration service depends on it.
- **Document caching if used:** If `getPartnerConfig(partnerId)` is cached (e.g. in-memory, TTL), document TTL, invalidation behavior, and that new partners/config may take up to TTL to appear.

**Checklist:** Adapter registry (adapterKey → constructor); new partner = registry entry only; factory uses registry; registry SLA documented; caching (if used) documented.

---

### Step 4 – Patterns: Shared base adapter (getAuthHeaders, request, error handling)

**Goal:** Introduce a **small shared base** (e.g. **base adapter** with **getAuthHeaders**, **request**, **error handling**) to **reduce duplication** and **standardize resilience behavior** across adapters.

- **Base adapter:** Create `src/adapters/base.adapter.ts`. Abstract class (or equivalent) that provides:
  - **getAuthHeaders(): Promise<Record<string, string>>** – default from config/authConfig; subclasses override for partner-specific header (e.g. `key` vs `X-API-Key`).
  - **request&lt;T&gt;(options): Promise&lt;T&gt;** – builds URL, adds auth (via getAuthHeaders), applies timeout, **retry/backoff**, **optional circuit breaker**, calls axios; on failure calls **translateError(partnerId, err)** and throws. Single place for resilience.
  - **baseUrl(): string** – from config, trimmed.
  - **translateError(partnerId, err)** – map 4xx/5xx/timeout/network to `InvalidPartnerResponseError` / `PartnerUnavailableError`; used by all adapters.
- **Partner adapters:** Redcliffe and Orange **extend** BasePartnerAdapter. Override getAuthHeaders if needed; implement only endpoint paths and body/response mapping; use **this.request()** for all outbound HTTP. No duplicate retry/circuit-breaker/error logic.

**Checklist:** BasePartnerAdapter with getAuthHeaders, request (with retry/circuit breaker), baseUrl, translateError; Redcliffe and Orange extend it and use this.request(); no duplicate resilience logic in adapters.

---

### Phase 0 summary

| Mandatory step | Pillar | Deliverables |
|----------------|--------|---------------|
| 1. Reusability | Base command + per-partner validation | BaseCreateOrderCommand + extensions; getCreateOrderSchema(partnerId); validate per partner in handlers |
| 2. Standards | Idempotency, retry, circuit breaker, contracts | Idempotency-Key for create/reschedule/cancel; retry/backoff + optional circuit breaker; docs/partner-contracts (and optional type generation) |
| 3. Scalability | Adapter registry + docs | adapterKey → constructor registry; new partner = registry entry; document registry SLA and caching if used |
| 4. Patterns | Base adapter | BasePartnerAdapter (getAuthHeaders, request, error handling); all adapters extend and use this.request() |

---

## 🔴 PHASE 1: CRITICAL APIS - Detailed Implementation Plan

### 1.1 Create Order - Redcliffe Labs

**Status:** ✅ **FULLY IMPLEMENTED**

#### Files to Modify:
- `src/adapters/redcliffe.adapter.ts`
- `src/models/order.command.ts`
- `src/validation/createOrder.schema.ts`

#### Step-by-Step Implementation:

**Step 1: Fix Authentication Header**
```typescript
// File: src/adapters/redcliffe.adapter.ts
// CURRENT (WRONG):
...(apiKey && { Authorization: `Bearer ${apiKey}` }),

// REQUIRED (CORRECT):
private async getAuthHeaders(): Promise<Record<string, string>> {
  let apiKey: string;
  
  if (this.config.authConfig) {
    const raw = await getSecretValue(this.config.authConfig.credentialsSecretArn);
    const parsed = parseSecretAsJson(raw);
    apiKey = (typeof parsed.apiKey === 'string' ? parsed.apiKey : null) ?? raw;
  } else {
    apiKey = await getPartnerApiKey(REDCLIFFE_SECRET_ARN_KEY, REDCLIFFE_API_KEY_ENV);
  }
  
  return {
    'Content-Type': 'application/json',
    ...(apiKey && { key: apiKey }),  // ✅ Redcliffe uses "key" header
  };
}
```

**Step 2: Fix Endpoint**
```typescript
// File: src/adapters/redcliffe.adapter.ts
// CURRENT (WRONG):
const url = `${this.baseUrl()}/orders`;

// REQUIRED (CORRECT):
const url = `${this.baseUrl()}/api/external/v2/center-create-booking/`;
```

**Step 3: Extend CreateOrderCommand Interface**
```typescript
// File: src/models/order.command.ts
export interface CreateOrderCommand {
  // Existing generic fields
  partnerId: string;
  patientId: string;
  patientName?: string;
  testCodes: string[];
  specimenType?: string;
  priority?: 'ROUTINE' | 'URGENT' | 'STAT';
  notes?: string;
  externalReferenceId?: string;
  
  // Redcliffe-specific optional fields
  bookingDate?: string;              // YYYY-MM-DD format
  collectionDate?: string;           // YYYY-MM-DD format
  collectionSlot?: number;           // Slot ID
  customerAddress?: string;
  customerAge?: string;
  customerAltPhoneNumber?: string;
  customerEmail?: string;
  customerGender?: 'male' | 'female';
  customerLatitude?: number;
  customerLongitude?: number;
  customerPhoneNumber?: string;
  customerWhatsAppNumber?: string;
  isCredit?: boolean;
  landmark?: string;
  pincode?: string;
  referenceData?: string;
  additionalMember?: Array<{
    customerName: string;
    nameTrue: boolean;
    customerAge: string;
    customerGender: 'male' | 'female';
    packageCode: string[];
  }>;
}
```

**Step 4: Update Validation Schema**
```typescript
// File: src/validation/createOrder.schema.ts
import { z } from 'zod';

const prioritySchema = z.enum(['ROUTINE', 'URGENT', 'STAT']);
const genderSchema = z.enum(['male', 'female']);
const datePattern = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const phonePattern = z.string().regex(/^[6-9]\d{9}$/);

export const createOrderSchema = z
  .object({
    // Existing fields
    partnerId: z.string().min(1).max(128),
    patientId: z.string().min(1).max(256),
    patientName: z.string().max(512).optional(),
    testCodes: z.array(z.string().min(1).max(64)).min(1).max(100),
    specimenType: z.string().max(128).optional(),
    priority: prioritySchema.optional(),
    notes: z.string().max(2000).optional(),
    externalReferenceId: z.string().max(256).optional(),
    
    // Redcliffe-specific optional fields
    bookingDate: datePattern.optional(),
    collectionDate: datePattern.optional(),
    collectionSlot: z.number().int().positive().optional(),
    customerAddress: z.string().max(500).optional(),
    customerAge: z.string().max(10).optional(),
    customerAltPhoneNumber: phonePattern.optional(),
    customerEmail: z.string().email().max(256).optional(),
    customerGender: genderSchema.optional(),
    customerLatitude: z.number().min(-90).max(90).optional(),
    customerLongitude: z.number().min(-180).max(180).optional(),
    customerPhoneNumber: phonePattern.optional(),
    customerWhatsAppNumber: phonePattern.optional(),
    isCredit: z.boolean().optional(),
    landmark: z.string().max(200).optional(),
    pincode: z.string().length(6).optional(),
    referenceData: z.string().max(256).optional(),
    additionalMember: z.array(
      z.object({
        customerName: z.string().min(3).max(256),
        nameTrue: z.boolean(),
        customerAge: z.string().max(10),
        customerGender: genderSchema,
        packageCode: z.array(z.string().min(1).max(64)).min(1),
      })
    ).optional(),
  })
  .strict();
```

**Step 5: Update Request Body Mapping**
```typescript
// File: src/adapters/redcliffe.adapter.ts
private mapCreateOrderBody(command: CreateOrderCommand): Record<string, unknown> {
  const body: Record<string, unknown> = {
    // Required fields - must be provided or throw error
    booking_date: command.bookingDate || new Date().toISOString().split('T')[0],
    collection_date: command.collectionDate || command.bookingDate || new Date().toISOString().split('T')[0],
    collection_slot: command.collectionSlot ?? 1,
    customer_name: command.patientName || 'Unknown',
    package_code: command.testCodes,
    reference_data: command.patientId || command.externalReferenceId,
    
    // Redcliffe-specific fields (if provided)
    ...(command.customerAddress && { customer_address: command.customerAddress }),
    ...(command.customerAge && { customer_age: command.customerAge }),
    ...(command.customerAltPhoneNumber && { customer_altphonenumber: command.customerAltPhoneNumber }),
    ...(command.customerEmail && { customer_email: command.customerEmail }),
    ...(command.customerGender && { customer_gender: command.customerGender }),
    ...(command.customerLatitude !== undefined && { customer_latitude: command.customerLatitude }),
    ...(command.customerLongitude !== undefined && { customer_longitude: command.customerLongitude }),
    ...(command.customerPhoneNumber && { customer_phonenumber: command.customerPhoneNumber }),
    ...(command.customerWhatsAppNumber && { customer_whatsapppnumber: command.customerWhatsAppNumber }),
    ...(command.isCredit !== undefined && { is_credit: command.isCredit }),
    ...(command.landmark && { landmark: command.landmark }),
    ...(command.pincode && { pincode: command.pincode }),
    ...(command.additionalMember && { additional_member: command.additionalMember }),
  };
  
  // Validate required fields are present
  const requiredFields = [
    'booking_date', 'collection_date', 'collection_slot',
    'customer_name', 'package_code', 'customer_email',
    'customer_gender', 'customer_latitude', 'customer_longitude',
    'customer_phonenumber', 'customer_whatsapppnumber',
    'is_credit', 'landmark', 'pincode'
  ];
  
  const missingFields = requiredFields.filter(field => !body[field]);
  if (missingFields.length > 0) {
    throw new InvalidPartnerResponseError(
      this.config.partnerId,
      `Missing required fields for Redcliffe booking: ${missingFields.join(', ')}`
    );
  }
  
  return body;
}
```

**Step 6: Testing Checklist**
- [ ] Test with minimal generic fields (should fail with clear error)
- [ ] Test with all Redcliffe-specific fields (should succeed)
- [ ] Verify authentication header is `key` not `Authorization`
- [ ] Verify endpoint is `/api/external/v2/center-create-booking/`
- [ ] Verify request body matches Redcliffe format

**Reference:** See Section 1.1 above for complete field mapping details.

---

### 1.2 Create Order - Orange Health

**Status:** ✅ **FULLY IMPLEMENTED**

**Implementation Notes:**
- Authentication: Uses `api_key` header (as per Orange Health API documentation)
- Endpoint: `/lab/orders` (POST)
- Base URLs:
  - Testing: `https://sandbox-partner-api.orangehealth.dev`
  - Production: `https://partner-api.orangehealth.in`

#### Files to Modify:
- `src/adapters/orange.adapter.ts`
- `src/models/order.command.ts` (may need extension)
- `src/validation/createOrder.schema.ts` (may need extension)

#### Step-by-Step Implementation:

**Step 1: Verify Authentication**
- [ ] Access Orange Health API docs: https://orangehealth.docs.apiary.io/
- [ ] Verify header name is `X-API-Key` (currently implemented)
- [ ] Verify header format matches API requirements
- [ ] Test authentication with actual API

**Step 2: Verify Endpoint**
- [ ] Verify endpoint path is `/lab/orders` (currently implemented)
- [ ] Verify HTTP method is POST
- [ ] Verify base URL matches: `https://sandbox-partner-api.orangehealth.dev/`

**Step 3: Verify Request Body**
- [ ] Verify all field names match Orange Health API exactly (case-sensitive)
- [ ] Check if Orange Health requires additional fields
- [ ] Verify data types match API requirements
- [ ] Verify required vs optional fields

**Step 4: Update Implementation (if needed)**
```typescript
// File: src/adapters/orange.adapter.ts
// Update based on verification results from API docs
private mapCreateOrderBody(command: CreateOrderCommand): Record<string, unknown> {
  // Update field names if they differ from generic
  // Add any Orange-specific required fields
  return {
    // Map based on verified API requirements
  };
}
```

**Step 5: Testing Checklist**
- [ ] Test with actual Orange Health sandbox API
- [ ] Verify all field names match API
- [ ] Test error scenarios
- [ ] Verify response mapping

**Reference:** See Section 1.2 above for complete verification checklist.

---

### 1.3 Reschedule Order - Redcliffe Labs

**Status:** ✅ **FULLY IMPLEMENTED**

#### Files to Create/Modify:
- `src/adapters/partner.adapter.ts` (add method to interface)
- `src/adapters/redcliffe.adapter.ts` (implement method)
- `src/models/order.command.ts` (add RescheduleOrderCommand interface)
- `src/validation/rescheduleOrder.schema.ts` (create new)
- `src/services/integration.service.ts` (add service function)
- `src/handlers/rescheduleOrder.ts` (create new)
- `serverless.yml` (add endpoint)

#### Step-by-Step Implementation:

**Step 1: Add to PartnerAdapter Interface**
```typescript
// File: src/adapters/partner.adapter.ts
export interface PartnerAdapter {
  createOrder(command: CreateOrderCommand): Promise<IntegrationResult>;
  rescheduleOrder(orderId: string, command: RescheduleOrderCommand): Promise<IntegrationResult>;  // ✅ Add this
  cancelOrder(orderId: string): Promise<IntegrationResult>;
  fetchStatus(orderId: string): Promise<IntegrationResult>;
}
```

**Step 2: Create RescheduleOrderCommand Interface**
```typescript
// File: src/models/order.command.ts
export interface RescheduleOrderCommand {
  partnerId: string;
  orderId: string;
  collectionDate: string;        // YYYY-MM-DD format
  collectionSlot: number;        // Slot ID
  remark?: string;               // Optional cancellation/reschedule reason
}
```

**Step 3: Create Validation Schema**
```typescript
// File: src/validation/rescheduleOrder.schema.ts
import { z } from 'zod';

const datePattern = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const rescheduleOrderSchema = z.object({
  partnerId: z.string().min(1).max(128),
  orderId: z.string().min(1).max(256),
  collectionDate: datePattern,
  collectionSlot: z.number().int().positive(),
  remark: z.string().max(500).optional(),
});

export const rescheduleOrderPathSchema = z.object({
  orderId: z.string().min(1).max(256),
});
```

**Step 4: Implement in Redcliffe Adapter**
```typescript
// File: src/adapters/redcliffe.adapter.ts
async rescheduleOrder(orderId: string, command: RescheduleOrderCommand): Promise<IntegrationResult> {
  const { partnerId } = this.config;
  
  // Convert orderId (string) to booking_id (number)
  const bookingId = parseInt(orderId, 10);
  if (isNaN(bookingId)) {
    throw new InvalidPartnerResponseError(partnerId, `Invalid orderId format: ${orderId}. Expected numeric booking_id.`);
  }
  
  const url = `${this.baseUrl()}/api/external/v2/center-update-booking/`;
  const headers = await this.getAuthHeaders();
  
  // Required request body
  const requestBody = {
    booking_id: bookingId,
    booking_status: 'rescheduled',
    collection_slot: command.collectionSlot,
    collection_date: command.collectionDate,
    remark: command.remark || 'Order rescheduled',
  };
  
  try {
    const { data } = await axios.post<PartnerOrderPayload>(url, requestBody, {
      timeout: REQUEST_TIMEOUT_MS,
      headers,
    });
    return toResult(data ?? null, { orderId, success: true });
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      const responseData = err.response.data;
      if (responseData && typeof responseData === 'object' && 'errors' in responseData) {
        const errors = (responseData as { errors?: unknown }).errors;
        if (Array.isArray(errors) && errors.includes('Dont have a matching booking')) {
          return toResultError(orderId, 'Booking ID does not exist or is not accessible');
        }
      }
      return toResultError(orderId, 'Order not found');
    }
    translateError(partnerId, err);
  }
}
```

**Step 5: Add Service Function**
```typescript
// File: src/services/integration.service.ts
export async function rescheduleOrder(
  partnerId: string,
  orderId: string,
  command: RescheduleOrderCommand
): Promise<IntegrationResult> {
  const config = await getPartnerConfig(partnerId);
  const adapter = getAdapter(partnerId, config);
  return adapter.rescheduleOrder(orderId, command);
}
```

**Step 6: Create Handler**
```typescript
// File: src/handlers/rescheduleOrder.ts
// Follow same pattern as cancelOrder.ts
// - Validate path parameters (orderId)
// - Validate request body (reschedule data)
// - Call integrationService.rescheduleOrder()
// - Handle all error types
// - Add logging
```

**Step 7: Add to Serverless Config**
```yaml
# File: serverless.yml
rescheduleOrder:
  handler: src/handlers/rescheduleOrder.main
  timeout: 10
  memorySize: 256
  events:
    - http:
        path: /orders/{orderId}/reschedule
        method: post
        cors:
          origin: ${self:custom.cors.origin}
          headers: ${self:custom.cors.headers}
```

**Step 8: Testing Checklist**
- [ ] Test rescheduleOrder with valid booking_id
- [ ] Test rescheduleOrder with invalid booking_id (should handle error)
- [ ] Test rescheduleOrder with missing required fields (should validate)
- [ ] Verify endpoint matches Redcliffe API

---

### 1.4 Reschedule Order - Orange Health

**Status:** ✅ **FULLY IMPLEMENTED**

**Implementation Notes:**
- Endpoint: `/lab/orders/{orderId}/reschedule` (POST)
- Uses `api_key` header for authentication
- Request body includes `newScheduledDate` (optional)

#### Step-by-Step Implementation:

**Step 1: Verify API Exists**
- [ ] Access Orange Health API docs: https://orangehealth.docs.apiary.io/
- [ ] Verify reschedule endpoint exists
- [ ] Note exact endpoint path
- [ ] Note HTTP method
- [ ] Note request body schema

**Step 2: Implement Based on Verification**
- [ ] Follow same pattern as Redcliffe
- [ ] Update endpoint path based on API docs
- [ ] Update request body mapping based on API docs
- [ ] Add Orange-specific error handling if needed

**Step 3: Testing Checklist**
- [ ] Test with Orange Health sandbox API
- [ ] Verify all field names match API
- [ ] Test error scenarios

---

### 1.5 Cancel Order - Redcliffe Labs

**Status:** ✅ **FULLY IMPLEMENTED**

#### Files to Modify:
- `src/adapters/redcliffe.adapter.ts`

#### Step-by-Step Implementation:

**Step 1: Fix Endpoint**
```typescript
// File: src/adapters/redcliffe.adapter.ts
// CURRENT (WRONG):
const url = `${this.baseUrl()}/orders/${encodeURIComponent(orderId)}/cancel`;

// REQUIRED (CORRECT):
const url = `${this.baseUrl()}/api/external/v2/center-update-booking/`;
```

**Step 2: Fix Request Body**
```typescript
// File: src/adapters/redcliffe.adapter.ts
// CURRENT (WRONG):
const { data } = await axios.post<PartnerOrderPayload>(url, {}, {

// REQUIRED (CORRECT):
async cancelOrder(orderId: string, remark?: string): Promise<IntegrationResult> {
  const { partnerId } = this.config;
  
  // Convert orderId (string) to booking_id (number)
  const bookingId = parseInt(orderId, 10);
  if (isNaN(bookingId)) {
    throw new InvalidPartnerResponseError(partnerId, `Invalid orderId format: ${orderId}. Expected numeric booking_id.`);
  }
  
  const url = `${this.baseUrl()}/api/external/v2/center-update-booking/`;
  const headers = await this.getAuthHeaders();
  
  const requestBody = {
    booking_id: bookingId,
    booking_status: 'cancelled',
    remark: remark || 'Order cancelled',
  };
  
  try {
    const { data } = await axios.post<PartnerOrderPayload>(url, requestBody, {
      timeout: REQUEST_TIMEOUT_MS,
      headers,
    });
    return toResult(data ?? null, { orderId, success: true });
  } catch (err) {
    // Handle specific Redcliffe error
    if (isAxiosError(err) && err.response?.status === 404) {
      const responseData = err.response.data;
      if (responseData && typeof responseData === 'object' && 'errors' in responseData) {
        const errors = (responseData as { errors?: unknown }).errors;
        if (Array.isArray(errors) && errors.includes('Dont have a matching booking')) {
          return toResultError(orderId, 'Booking ID does not exist or is not accessible');
        }
      }
      return toResultError(orderId, 'Order not found');
    }
    translateError(partnerId, err);
  }
}
```

**Step 3: Testing Checklist**
- [ ] Test cancelOrder with valid booking_id
- [ ] Test cancelOrder with invalid booking_id (should handle error)
- [ ] Verify endpoint matches Redcliffe API
- [ ] Verify request body format

**Reference:** See Section 1.5 above for complete details.

---

### 1.6 Cancel Order - Orange Health

**Status:** ✅ **FULLY IMPLEMENTED**

**Implementation Notes:**
- Endpoint: `/lab/orders/{orderId}/cancel` (POST)
- Uses `api_key` header for authentication
- Request body includes `remark` (optional)

#### Step-by-Step Implementation:

**Step 1: Verify Endpoint**
- [ ] Verify endpoint path is `/lab/orders/{orderId}/cancel` (currently implemented)
- [ ] Verify HTTP method is POST
- [ ] Verify if request body is required (currently empty)

**Step 2: Verify Request Body**
- [ ] Check if cancellation requires additional fields (reason, remark, etc.)
- [ ] Verify orderId format and location (path vs body)

**Step 3: Update Implementation (if needed)**
- [ ] Update based on verification results

**Step 4: Testing Checklist**
- [ ] Test with Orange Health sandbox API
- [ ] Verify error handling

---

### 1.7 Get Order Status - Redcliffe Labs

**Status:** ✅ **FULLY IMPLEMENTED**

#### Files to Modify:
- `src/adapters/redcliffe.adapter.ts`

#### Step-by-Step Implementation:

**Step 1: Fix Endpoint**
```typescript
// File: src/adapters/redcliffe.adapter.ts
// CURRENT (WRONG):
const url = `${this.baseUrl()}/orders/${encodeURIComponent(orderId)}/status`;

// REQUIRED (CORRECT):
const url = `${this.baseUrl()}/api/external/v2/center-get-booking`;
```

**Step 2: Fix Request Format**
```typescript
// File: src/adapters/redcliffe.adapter.ts
// CURRENT (WRONG):
const { data } = await axios.get<PartnerOrderPayload>(url, {

// REQUIRED (CORRECT):
async fetchStatus(orderId: string): Promise<IntegrationResult> {
  const { partnerId } = this.config;
  
  // Convert orderId (string) to booking_id (number)
  const bookingId = parseInt(orderId, 10);
  if (isNaN(bookingId)) {
    throw new InvalidPartnerResponseError(partnerId, `Invalid orderId format: ${orderId}. Expected numeric booking_id.`);
  }
  
  const url = `${this.baseUrl()}/api/external/v2/center-get-booking`;
  const headers = await this.getAuthHeaders();
  
  try {
    // Use query parameter, not path parameter
    const { data } = await axios.get<PartnerOrderPayload>(url, {
      params: {
        booking_id: bookingId,  // Query parameter as number
      },
      timeout: REQUEST_TIMEOUT_MS,
      headers,
    });
    
    // Handle specific Redcliffe error response
    if (data && typeof data === 'object' && 'errors' in data) {
      const errors = (data as { errors?: unknown }).errors;
      if (Array.isArray(errors) && errors.includes('Dont have a matching booking')) {
        return toResultError(orderId, 'Booking ID does not exist or is not accessible');
      }
    }
    
    return toResult(data ?? null, { orderId, success: true });
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) {
      const responseData = err.response.data;
      if (responseData && typeof responseData === 'object' && 'errors' in responseData) {
        const errors = (responseData as { errors?: unknown }).errors;
        if (Array.isArray(errors) && errors.includes('Dont have a matching booking')) {
          return toResultError(orderId, 'Booking ID does not exist or is not accessible');
        }
      }
      return toResultError(orderId, 'Order not found');
    }
    translateError(partnerId, err);
  }
}
```

**Step 3: Testing Checklist**
- [ ] Test fetchStatus with valid booking_id
- [ ] Test fetchStatus with invalid booking_id (should handle error)
- [ ] Verify endpoint uses query parameter, not path parameter
- [ ] Verify orderId conversion (string to number)

**Reference:** See Section 1.7 above for complete details.

---

### 1.8 Get Order Status - Orange Health

**Status:** ✅ **FULLY IMPLEMENTED**

**Implementation Notes:**
- Endpoint: `/lab/orders/{orderId}/status` (GET)
- Uses `api_key` header for authentication
- Handles error responses with proper error messages

#### Step-by-Step Implementation:

**Step 1: Verify Endpoint**
- [ ] Verify endpoint path is `/lab/orders/{orderId}/status` (currently implemented)
- [ ] Verify HTTP method is GET
- [ ] Verify if orderId should be path parameter or query parameter

**Step 2: Update Implementation (if needed)**
- [ ] Update based on verification results

**Step 3: Testing Checklist**
- [ ] Test with Orange Health sandbox API
- [ ] Verify response format

---

## 🟠 PHASE 2: HIGH PRIORITY APIS - Implementation Plan

### 2.1 Get Serviceable Locations

**Redcliffe Labs:**
- **Endpoint:** `GET /api/partner/v2/get-partner-location-2-eloc/`
- **Parameters:** `place_query` (query param)
- **Description:** Get list of serviceable locations based on place query
- **Implementation:** Create new handler, adapter method, service function

**Orange Health:**
- **Status:** ⚠️ Verify if exists in API docs
- **Implementation:** Follow same pattern after verification

### 2.2 Get Partner Location

**Redcliffe Labs:**
- **Endpoint:** `GET /api/partner/v2/get-partner-loc-2-eloc/`
- **Parameters:** `eloc` (query param)
- **Description:** Get partner location details by eloc
- **Implementation:** Create new handler, adapter method, service function

**Orange Health:**
- **Status:** ⚠️ Verify if exists in API docs
- **Implementation:** Follow same pattern after verification

### 2.3 Search Packages

**Redcliffe Labs:**
- **Endpoint:** `GET /api/external/v2/center-package-data/`
- **Parameters:** `search` (query param)
- **Description:** Search for available packages/test packages
- **Implementation:** Create new handler, adapter method, service function

**Orange Health:**
- **Status:** ⚠️ Verify if exists in API docs
- **Implementation:** Follow same pattern after verification

### 2.4 Get Package Details

**Redcliffe Labs:**
- **Endpoint:** `GET /api/external/v2/package-parameter-data/`
- **Parameters:** `code` (query param)
- **Description:** Get detailed information about a specific package by code
- **Implementation:** Create new handler, adapter method, service function

**Orange Health:**
- **Status:** ⚠️ Verify if exists in API docs
- **Implementation:** Follow same pattern after verification

### 2.5 Get Booking Slots

**Redcliffe Labs:**
- **Endpoint:** `GET /api/booking/v2/get-time-slot-list/`
- **Parameters:** `latitude`, `longitude`, `collection_date` (query params)
- **Description:** Get available time slots for booking
- **Implementation:** Create new handler, adapter method, service function

**Orange Health:**
- **Status:** ⚠️ Verify if exists in API docs
- **Implementation:** Follow same pattern after verification

**Implementation Pattern for Phase 2 APIs:**
1. Create canonical model/interface for request/response
2. Create validation schema
3. Add method to PartnerAdapter interface
4. Implement in adapter (Redcliffe/Orange)
5. Add service function
6. Create handler
7. Add to serverless.yml
8. Test

---

## 🟡 PHASE 3: MEDIUM PRIORITY APIS - Implementation Plan

### 3.1 Confirm Booking/Order
### 3.2 Update Package
### 3.3 Get Consolidated Report
### 3.4 Get Digital Report

**Implementation Pattern:** Same as Phase 2, implement after Phase 1 and 2 are complete.

---

## 📝 Complete Implementation Checklist

### Phase 0: Four Mandatory Architectural Steps
- [x] **Step 1 – Reusability:** Base order command + partner extensions; separate Zod schemas per adapter; getCreateOrderSchema(partnerId); validate per partner in handlers ✅
- [x] **Step 2 – Standards:** Idempotency for create/reschedule/cancel; retry/backoff; optional circuit breaker; document (or generate) partner request/response contracts ✅
- [x] **Step 3 – Scalability:** Adapter factory refactored to registry (adapterKey → constructor); new partner types without editing factory; document registry SLA and caching if used ✅
- [x] **Step 4 – Patterns:** Shared base adapter with getAuthHeaders, request, error handling; all adapters extend base and use this.request(); resilience behavior standardized ✅

### Phase 1: Critical APIs

#### Redcliffe Labs
- [x] **1.1.1** Fix authentication header (use `key` instead of `Authorization`) ✅
- [x] **1.1.2** Fix createOrder endpoint ✅
- [x] **1.1.3** Extend CreateOrderCommand interface ✅
- [x] **1.1.4** Update validation schema ✅
- [x] **1.1.5** Update request body mapping ✅
- [x] **1.3.1** Add rescheduleOrder to interface ✅
- [x] **1.3.2** Implement rescheduleOrder in adapter ✅
- [x] **1.3.3** Create RescheduleOrderCommand interface ✅
- [x] **1.3.4** Create validation schema ✅
- [x] **1.3.5** Create handler ✅
- [x] **1.3.6** Add to serverless.yml ✅
- [x] **1.5.1** Fix cancelOrder endpoint ✅
- [x] **1.5.2** Fix cancelOrder request body ✅
- [x] **1.7.1** Fix fetchStatus endpoint ✅
- [x] **1.7.2** Fix fetchStatus to use query parameter ✅

#### Orange Health
- [x] **1.2.1** Verify authentication method ✅ (Uses `api_key` header)
- [x] **1.2.2** Verify createOrder endpoint ✅ (`/lab/orders`)
- [x] **1.2.3** Verify createOrder request body ✅
- [x] **1.2.4** Update implementation based on verification ✅
- [x] **1.4.1** Verify rescheduleOrder API exists ✅
- [x] **1.4.2** Implement rescheduleOrder based on verification ✅
- [x] **1.6.1** Verify cancelOrder endpoint ✅ (`/lab/orders/{orderId}/cancel`)
- [x] **1.6.2** Update cancelOrder based on verification ✅
- [x] **1.8.1** Verify getOrderStatus endpoint ✅ (`/lab/orders/{orderId}/status`)
- [x] **1.8.2** Update getOrderStatus based on verification ✅

### Phase 2: High Priority APIs
- [ ] Implement all 5 APIs for Redcliffe
- [ ] Verify and implement all 5 APIs for Orange (if they exist)

### Phase 3: Medium Priority APIs
- [ ] Implement all 4 APIs for Redcliffe
- [ ] Verify and implement all 4 APIs for Orange (if they exist)

---

## 🔧 Common Implementation Patterns

All patterns below align with the **four mandatory steps**: use the **base adapter** (getAuthHeaders, request, error handling), **adapter registry** for resolving partners, **per-partner validation** (e.g. getXxxSchema(partnerId)) where applicable, and **Idempotency-Key** for write operations (create/reschedule/cancel).

### Pattern 1: Adding New API to Adapter

1. **Add to Interface:**
```typescript
// File: src/adapters/partner.adapter.ts
export interface PartnerAdapter {
  // ... existing methods
  newMethod(params: NewMethodParams): Promise<IntegrationResult>;
}
```

2. **Implement in Adapter:**
```typescript
// File: src/adapters/[partner].adapter.ts
async newMethod(params: NewMethodParams): Promise<IntegrationResult> {
  const { partnerId } = this.config;
  const url = `${this.baseUrl()}/[endpoint]`;
  const headers = await this.getAuthHeaders();
  
  try {
    const { data } = await axios.[method]<ResponseType>(url, {
      // ... request config
    });
    return toResult(data ?? null, { success: true });
  } catch (err) {
    translateError(partnerId, err);
  }
}
```

3. **Add Service Function:**
```typescript
// File: src/services/integration.service.ts
export async function newMethod(
  partnerId: string,
  params: NewMethodParams
): Promise<IntegrationResult> {
  const config = await getPartnerConfig(partnerId);
  const adapter = getAdapter(partnerId, config);
  return adapter.newMethod(params);
}
```

4. **Create Handler:**
```typescript
// File: src/handlers/newMethod.ts
// Follow pattern from existing handlers
```

5. **Add to Serverless:**
```yaml
# File: serverless.yml
newMethod:
  handler: src/handlers/newMethod.main
  timeout: 10
  memorySize: 256
  events:
    - http:
        path: /[path]
        method: [method]
        cors:
          origin: ${self:custom.cors.origin}
          headers: ${self:custom.cors.headers}
```

---

## 📚 Reference Documents Quick Access

### Redcliffe Labs
- **Postman Collection:** https://api.postman.com/collections/25836147-c45099eb-2f45-4e29-8a0f-d8da1e36c889
- **Old Implementation:** `Common-Backend/third_party_integration/redcliffe_lab/`
- **Complete API List:** See Section "Phase 2: High Priority APIs" and "Phase 3: Medium Priority APIs" in this document

### Orange Health
- **API Documentation:** https://orangehealth.docs.apiary.io/
- **Base URLs:**
  - Production: `https://sandbox-partner-api.orangehealth.dev/`
  - Mock: `https://private-anon-47f4cedde4-orangehealth.apiary-mock.com/`
- **Complete API List:** See Section "Phase 2: High Priority APIs" and "Phase 3: Medium Priority APIs" in this document

---

## ⚠️ Important Notes

0. **Four mandatory steps (Phase 0 first):** Complete the four architectural steps before or in parallel with Phase 1: (1) **Reusability** – base order command and partner-specific extensions, separate Zod schemas per adapter, validate per partner; (2) **Standards** – idempotency for create/reschedule/cancel, retry/backoff, optional circuit breaker, document or generate partner request/response contracts; (3) **Scalability** – adapter factory refactored to registry (adapterKey → constructor), new partner types without editing factory, document registry SLA and caching if used; (4) **Patterns** – shared base adapter with getAuthHeaders, request, error handling to reduce duplication and standardize resilience. See "Four Mandatory Architectural Steps" and "PHASE 0: ARCHITECTURAL FOUNDATION".

1. **OrderId Format:** Redcliffe uses numeric `booking_id`, but our system uses string `orderId`. Always convert with validation.

2. **Authentication:** 
   - Redcliffe uses `key` header
   - Orange uses `X-API-Key` header (verify)

3. **Required Fields:** The generic `CreateOrderCommand` doesn't include all partner-required fields. Adapters should:
   - Accept extended command with partner-specific fields (preferred)
   - OR throw clear error indicating missing required fields

4. **Backward Compatibility:** Extending `CreateOrderCommand` with optional fields maintains backward compatibility with other adapters.

5. **Error Messages:** Provide clear, actionable error messages when required fields are missing.

6. **Testing:** Always test with actual partner API (sandbox/mock) to verify all mappings work correctly.

7. **Verification First:** For Orange Health, always verify against API docs before implementing.

---

## 🚀 Getting Started

1. **Complete the four mandatory architectural steps (Phase 0)**
   - **Step 1 – Reusability:** Base order command and partner extensions; separate Zod schemas per adapter; validate per partner.
   - **Step 2 – Standards:** Idempotency for create/reschedule/cancel; retry/backoff and optional circuit breaker; document (or generate) partner request/response contracts.
   - **Step 3 – Scalability:** Refactor adapter factory to registry (adapterKey → constructor); document registry SLA and caching if used.
   - **Step 4 – Patterns:** Shared base adapter with getAuthHeaders, request, error handling; reduce duplication and standardize resilience across adapters.
   - See "PHASE 0: ARCHITECTURAL FOUNDATION" for detailed implementation.

2. **Then Phase 1: Critical APIs**
   - Begin with Redcliffe (has old implementation reference), then Orange (verify first, then implement).

3. **Phase 1 implementation order:**
   - Create Order (update existing)
   - Reschedule Order (implement new)
   - Cancel Order (update existing)
   - Get Order Status (update existing)

4. **For each API:** Read the detailed steps, refer to partner guides and Phase 0 patterns, implement step-by-step, test, mark checklist complete.

5. **After Phase 1:** Phase 2 (High Priority) → Phase 3 (Medium) → Phase 4 (Low).

---

**End of Master Implementation Plan**

**Last Updated:** Consolidated from all reference documents; includes Four Mandatory Architectural Steps and Phase 0.  
**Next Steps:** Complete Phase 0 (four steps: Reusability, Standards, Scalability, Patterns), then Phase 1 implementation.

---

**Note:** This is the single source of truth for partner integration implementation. All previous guides have been consolidated into this master plan.
