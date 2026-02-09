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
- Orange Health API Docs: https://orangehealth.docs.apiary.io/
- Old Redcliffe Implementation: `Common-Backend/third_party_integration/redcliffe_lab/`

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

### Phase 1: Critical (Must Have) - Start Here
**Priority:** 🔴 **CRITICAL**  
**Timeline:** Week 1-2

1. ✅ **Create Order** (both partners - update existing)
2. ✅ **Reschedule Order** (both partners - implement new)
3. ✅ **Cancel Order** (both partners - update existing)
4. ✅ **Get Order Status** (both partners - update existing)

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

## 🔴 PHASE 1: CRITICAL APIS - Detailed Implementation Plan

### 1.1 Create Order - Redcliffe Labs

**Status:** ✅ Partially implemented (needs updates)

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

**Status:** ✅ Partially implemented (needs verification)

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

**Status:** ❌ Not yet implemented

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

**Status:** ❌ Not yet implemented (needs verification)

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

**Status:** ✅ Partially implemented (needs updates)

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

**Status:** ✅ Partially implemented (needs verification)

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

**Status:** ✅ Partially implemented (needs updates)

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

**Status:** ✅ Partially implemented (needs verification)

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

### Phase 1: Critical APIs

#### Redcliffe Labs
- [ ] **1.1.1** Fix authentication header (use `key` instead of `Authorization`)
- [ ] **1.1.2** Fix createOrder endpoint
- [ ] **1.1.3** Extend CreateOrderCommand interface
- [ ] **1.1.4** Update validation schema
- [ ] **1.1.5** Update request body mapping
- [ ] **1.3.1** Add rescheduleOrder to interface
- [ ] **1.3.2** Implement rescheduleOrder in adapter
- [ ] **1.3.3** Create RescheduleOrderCommand interface
- [ ] **1.3.4** Create validation schema
- [ ] **1.3.5** Create handler
- [ ] **1.3.6** Add to serverless.yml
- [ ] **1.5.1** Fix cancelOrder endpoint
- [ ] **1.5.2** Fix cancelOrder request body
- [ ] **1.7.1** Fix fetchStatus endpoint
- [ ] **1.7.2** Fix fetchStatus to use query parameter

#### Orange Health
- [ ] **1.2.1** Verify authentication method
- [ ] **1.2.2** Verify createOrder endpoint
- [ ] **1.2.3** Verify createOrder request body
- [ ] **1.2.4** Update implementation based on verification
- [ ] **1.4.1** Verify rescheduleOrder API exists
- [ ] **1.4.2** Implement rescheduleOrder based on verification
- [ ] **1.6.1** Verify cancelOrder endpoint
- [ ] **1.6.2** Update cancelOrder based on verification
- [ ] **1.8.1** Verify getOrderStatus endpoint
- [ ] **1.8.2** Update getOrderStatus based on verification

### Phase 2: High Priority APIs
- [ ] Implement all 5 APIs for Redcliffe
- [ ] Verify and implement all 5 APIs for Orange (if they exist)

### Phase 3: Medium Priority APIs
- [ ] Implement all 4 APIs for Redcliffe
- [ ] Verify and implement all 4 APIs for Orange (if they exist)

---

## 🔧 Common Implementation Patterns

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

1. **Start with Phase 1: Critical APIs**
   - Begin with Redcliffe (has old implementation reference)
   - Then move to Orange (verify first, then implement)

2. **Follow Implementation Order:**
   - Create Order (update existing)
   - Reschedule Order (implement new)
   - Cancel Order (update existing)
   - Get Order Status (update existing)

3. **For Each API:**
   - Read the detailed steps in this document
   - Refer to partner-specific guides for details
   - Implement step-by-step
   - Test thoroughly
   - Mark checklist as complete

4. **After Phase 1:**
   - Move to Phase 2 (High Priority APIs)
   - Then Phase 3 (Medium Priority APIs)
   - Finally Phase 4 (Low Priority APIs)

---

**End of Master Implementation Plan**

**Last Updated:** Consolidated from all reference documents  
**Next Steps:** Begin Phase 1 implementation

---

**Note:** This is the single source of truth for partner integration implementation. All previous guides have been consolidated into this master plan.
