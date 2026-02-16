# Master Implementation Plan
## Partner Integration - Pending Items Only

**Purpose:** This document tracks only pending items for partner integration. All completed implementations have been removed.

**Last Updated:** After webhook implementation completion  
**Status:** ✅ **14 APIs Complete** | ✅ **Webhooks Implemented** | ⏳ **Testing & Verification Pending**

---

## ⏳ Pending Items

### 1. Orange Health Endpoint Verification

**Status:** ⏳ **PENDING VERIFICATION**  
**Priority:** High  
**Estimated Effort:** 2-4 hours

**Description:** Verify all Orange Health API endpoints against official documentation.

**Action Required:**
1. Access Orange Health API documentation: https://orangehealth.docs.apiary.io/
2. Review detailed checklist in `ORANGE_HEALTH_ENDPOINT_VERIFICATION.md` (if exists)
3. For each endpoint in `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts`:
   - Verify correct HTTP method (GET, POST, PUT, DELETE)
   - Verify correct endpoint path
   - Verify request/response structure
   - Test with Orange Health sandbox API
4. Update endpoint paths if they differ from documentation
5. Document any discrepancies

**Quick Summary:**
- **Phase 1 (4 APIs):** ✅ Implemented - Needs verification
- **Phase 2 (5 APIs):** ⚠️ Placeholder endpoints - **VERIFY REQUIRED**
- **Phase 3 (4 APIs):** ⚠️ Placeholder endpoints - **VERIFY REQUIRED**
- **Phase 4 (1 API):** ⚠️ Placeholder endpoint - **VERIFY REQUIRED**

---

### 2. Redcliffe Labs Webhook Structure Verification

**Status:** ⏳ **PENDING VERIFICATION**  
**Priority:** Medium  
**Estimated Effort:** 1-2 hours

**Description:** Verify exact Redcliffe webhook payload structure from Postman collection.

**Action Required:**
1. Access Redcliffe Postman Collection: https://api.postman.com/collections/25836147-c45099eb-2f45-4e29-8a0f-d8da1e36c889
2. Review webhook-related endpoints:
   - `POST set webhook`
   - `POST trigger webhook (Staging)`
   - `GET webhook details`
3. Document exact webhook payload structure:
   - All possible event types
   - Payload fields and their types
   - Required vs optional fields
   - Event type indicators
4. Verify if signature validation is required
5. Verify if idempotency header is provided
6. Compare with current implementation in `redcliffe.webhook.ts`
7. Update adapter if structure differs from current assumptions

**Current Assumptions:**
- Payload structure: `{ booking_id, status, ... }`
- Event types mapped via `status` field
- No signature validation required (to be verified)

---

### 3. Redcliffe Webhook Adapter Updates (If Needed)

**Status:** ⏳ **PENDING - Depends on Item #2**  
**Priority:** Medium  
**Estimated Effort:** 1 hour (if updates needed)

**Description:** Update Redcliffe webhook adapter based on verified structure.

**Action Required:**
1. After verifying structure (Item #2), update `redcliffe.webhook.ts` if needed:
   - Update payload interface to match actual structure
   - Add/update event type mappings
   - Add signature validation if required
   - Handle idempotency header if provided
2. Ensure all event types are mapped to canonical types
3. Test with sample payloads

---

### 4. Webhook Secret Configuration

**Status:** ⏳ **PENDING CONFIGURATION**  
**Priority:** Medium  
**Estimated Effort:** 1-2 hours

**Description:** Ensure webhook secrets are added to partner credentials in the partner registry.

**Note:** Webhook secrets are already integrated with the partner registry system, using the same `authConfig.credentialsSecretArn` as other partner API credentials. No code changes needed - only configuration.

**Action Required:**
1. For Orange Health partners:
   - Add webhook secret to the existing credentials secret in AWS Secrets Manager (same secret used for API credentials)
   - Use one of the supported key names: `webhookSecret`, `webhook_secret`, `secretKey`, or `secret_key`
   - Test secret retrieval via partner registry
2. For Redcliffe Labs (if signature validation required):
   - Add webhook secret to credentials secret using the same approach
3. Document that webhook secrets are managed through partner registry (same as API credentials)

**Current Implementation:**
- ✅ Already integrated with partner registry via `authConfig.credentialsSecretArn`
- ✅ Uses same credentials secret as partner API authentication
- ✅ Retrieved in `webhook.service.ts` via `getWebhookSecret()` from partner registry config
- ✅ Supports multiple key name formats for flexibility

---

### 5. Testing - Orange Health Webhooks

**Status:** ⏳ **PENDING TESTING**  
**Priority:** High  
**Estimated Effort:** 2-3 hours

**Description:** Test Orange Health webhook implementation with sandbox environment.

**Test Cases:**
1. **Signature Validation:**
   - [ ] Valid signature accepted
   - [ ] Invalid signature rejected (401)
   - [ ] Missing signature handled correctly
   - [ ] Signature with different case handled correctly

2. **Event Parsing:**
   - [ ] All 12 Orange events parsed correctly
   - [ ] Unknown events rejected gracefully
   - [ ] Missing required fields handled
   - [ ] OrderId extracted correctly from various locations

3. **Idempotency:**
   - [ ] Duplicate webhooks (same `x-oh-event-id`) skipped
   - [ ] Fallback eventId generation works
   - [ ] Idempotency key format correct

4. **Event Mapping:**
   - [ ] All events map to correct canonical types
   - [ ] Event types validated with `isCanonicalLabEventType()`
   - [ ] Invalid mappings caught

5. **End-to-End:**
   - [ ] Webhook received → parsed → published to EventBridge
   - [ ] Error handling works correctly
   - [ ] Logging captures all important events

---

### 6. Testing - Redcliffe Labs Webhooks

**Status:** ⏳ **PENDING TESTING**  
**Priority:** Medium  
**Estimated Effort:** 1-2 hours

**Description:** Test Redcliffe Labs webhook implementation.

**Test Cases:**
1. **Payload Parsing:**
   - [ ] Current payload structure works
   - [ ] All event types mapped correctly
   - [ ] BookingId conversion to orderId works
   - [ ] Missing fields handled gracefully

2. **Backward Compatibility:**
   - [ ] Existing webhook payloads still work
   - [ ] New interface doesn't break existing flows

3. **End-to-End:**
   - [ ] Webhook received → parsed → published to EventBridge
   - [ ] Error handling works correctly

---

### 7. Unit Tests

**Status:** ⏳ **PENDING**  
**Priority:** High  
**Estimated Effort:** 4-6 hours

**Description:** Add comprehensive unit tests for webhook adapters and service.

**Test Files to Create/Update:**
1. `orange.webhook.spec.ts`:
   - [ ] Signature validation tests
   - [ ] Event parsing tests (all 12 events)
   - [ ] OrderId extraction tests
   - [ ] Invalid payload handling
   - [ ] Event type validation tests

2. `redcliffe.webhook.spec.ts`:
   - [ ] Payload parsing tests
   - [ ] Event type mapping tests
   - [ ] BookingId conversion tests
   - [ ] Invalid payload handling

3. `webhook.service.spec.ts`:
   - [ ] Secret retrieval tests
   - [ ] Idempotency tests
   - [ ] Error handling tests
   - [ ] Event publishing tests

---

### 8. Integration Tests

**Status:** ⏳ **PENDING**  
**Priority:** Medium  
**Estimated Effort:** 3-4 hours

**Description:** Add integration tests for end-to-end webhook flow.

**Test Scenarios:**
1. [ ] Webhook handler receives request → processes → returns response
2. [ ] Signature validation in integration flow
3. [ ] Idempotency in integration flow
4. [ ] EventBridge publishing in integration flow
5. [ ] Error scenarios (invalid signature, malformed payload, etc.)

---

### 9. Documentation Updates

**Status:** ⏳ **PENDING**  
**Priority:** Low  
**Estimated Effort:** 1-2 hours

**Description:** Update documentation to reflect webhook implementation.

**Documents to Update:**
1. [ ] Add webhook configuration guide
2. [ ] Add webhook troubleshooting guide
3. [ ] Document webhook secret management
4. [ ] Add webhook event type reference

---

## 📚 Reference Documents

### Orange Health
- **API Documentation:** https://orangehealth.docs.apiary.io/
- **Webhook Implementation:** `api-hub/libs/lab-integration/src/lib/adapters/orange/orange.webhook.ts`
- **Base URLs:**
  - Testing: `https://sandbox-partner-api.orangehealth.dev`
  - Production: `https://partner-api.orangehealth.in`

### Redcliffe Labs
- **Postman Collection:** https://api.postman.com/collections/25836147-c45099eb-2f45-4e29-8a0f-d8da1e36c889
- **API Documentation:** https://docs.google.com/document/d/1aXpnbanPV8jDVXok7pp-a3_LmsUYLcWQJbqO7IcBJh4/edit?tab=t.p68vd7si2ak5#heading=h.rezsv2g3r6vz
- **Current Implementation:** `api-hub/libs/lab-integration/src/lib/adapters/redcliffe/redcliffe.webhook.ts`
- **Legacy Implementation:** `Common-Backend/third_party_integration/redcliffe_lab_reports/index.js`

---

## ⚠️ Important Notes

1. **Orange Health Endpoints:** All Orange Health Phase 2, 3, and 4 endpoints use placeholder paths and need verification against API documentation.

2. **Authentication:** 
   - Redcliffe uses `key` header
   - Orange uses `api_key` header

3. **OrderId Format:** Redcliffe uses numeric `booking_id`, but our system uses string `orderId`. Always convert with validation.

4. **Testing:** Always test with actual partner API (sandbox/mock) to verify all mappings work correctly.

5. **Webhook Security:** Never log webhook secret keys or full payloads in production logs.

---

## 🚀 Recommended Next Steps

### Immediate (This Week)
1. Test Orange Health webhooks with sandbox
2. Verify Redcliffe webhook structure from Postman
3. Configure webhook secrets for Orange Health

### Short Term (Next Week)
1. Write unit tests for adapters
2. Verify Orange Health API endpoints
3. Update Redcliffe adapter if needed

### Medium Term (Next Sprint)
1. Integration tests
2. Documentation updates
3. Production deployment preparation

---

## 📊 Summary

### Estimated Total Remaining Effort
- **High Priority:** 8-12 hours
- **Medium Priority:** 4-6 hours
- **Low Priority:** 1-2 hours
- **Total:** 13-20 hours

### Priority Breakdown
1. **High Priority:**
   - Orange Health Endpoint Verification (2-4 hours)
   - Testing - Orange Health Webhooks (2-3 hours)
   - Unit Tests (4-6 hours)

2. **Medium Priority:**
   - Redcliffe Webhook Structure Verification (1-2 hours)
   - Redcliffe Adapter Updates (1 hour)
   - Webhook Secret Configuration (1-2 hours)
   - Testing - Redcliffe Labs Webhooks (1-2 hours)
   - Integration Tests (3-4 hours)

3. **Low Priority:**
   - Documentation Updates (1-2 hours)

---

**Last Updated:** After webhook implementation completion  
**Focus:** Only pending items are documented here
