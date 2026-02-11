# Master Implementation Plan
## Partner Integration - Pending Items Only

**Purpose:** This document tracks only pending items for partner integration. All completed implementations have been removed.

**Last Updated:** All phases 0-4 implemented except webhooks  
**Status:** ✅ **14 APIs Complete** | ⏳ **2 Items Pending**

---

## ⏳ Pending Items

### 1. Orange Health Endpoint Verification

The following Orange Health endpoints are implemented with placeholder paths based on common REST patterns. **Verification against Orange Health API documentation is required:**

**Phase 2 APIs:**
- [ ] Verify `GET /lab/locations` endpoint (Get Serviceable Locations)
  - Current implementation: `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` - Line 152
  - Action: Check Orange Health API docs and update if path differs

- [ ] Verify `GET /lab/locations/{eloc}` endpoint (Get Partner Location)
  - Current implementation: `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` - Line 168
  - Action: Check Orange Health API docs and update if path differs

- [ ] Verify `GET /lab/packages` endpoint (Search Packages)
  - Current implementation: `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` - Line 181
  - Action: Check Orange Health API docs and update if path differs

- [ ] Verify `GET /lab/packages/{code}` endpoint (Get Package Details)
  - Current implementation: `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` - Line 197
  - Action: Check Orange Health API docs and update if path differs

- [ ] Verify `GET /lab/slots` endpoint (Get Booking Slots)
  - Current implementation: `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` - Line 210
  - Action: Check Orange Health API docs and update if path differs

**Phase 3 APIs:**
- [ ] Verify `POST /lab/orders/{orderId}/confirm` endpoint (Confirm Booking)
  - Current implementation: `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` - Line 232
  - Action: Check Orange Health API docs and update if path differs

- [ ] Verify `PUT /lab/packages/{packageCode}` endpoint (Update Package)
  - Current implementation: `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` - Line 251
  - Action: Check Orange Health API docs and update if path differs

- [ ] Verify `GET /lab/orders/{orderId}/reports/consolidated` endpoint (Get Consolidated Report)
  - Current implementation: `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` - Line 268
  - Action: Check Orange Health API docs and update if path differs

- [ ] Verify `GET /lab/orders/{orderId}/reports/digital` endpoint (Get Digital Report)
  - Current implementation: `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` - Line 281
  - Action: Check Orange Health API docs and update if path differs

**Phase 4 APIs:**
- [ ] Verify `PUT /lab/orders/{orderId}/credit` endpoint (Update Credit)
  - Current implementation: `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` - Line 295
  - Action: Check Orange Health API docs and update if path differs

**Action Required:**
1. Access Orange Health API documentation: https://orangehealth.docs.apiary.io/
2. For each endpoint above, verify the correct path and HTTP method
3. Update the endpoint path in `libs/lab-integration/src/lib/adapters/orange/orange.adapter.ts` if it differs
4. Test with Orange Health sandbox API to confirm

---

### 2. Webhooks Implementation

**Status:** ⏳ **DEFERRED - Will be implemented later**

**Pending Tasks:**
- [ ] Design webhook architecture
- [ ] Define webhook event types
- [ ] Implement webhook handlers
- [ ] Add webhook configuration to partner config
- [ ] Set up webhook endpoint security
- [ ] Add webhook endpoints to serverless.yml

---

## 📚 Reference Documents

### Orange Health
- **API Documentation:** https://orangehealth.docs.apiary.io/
- **Base URLs:**
  - Testing: `https://sandbox-partner-api.orangehealth.dev`
  - Production: `https://partner-api.orangehealth.in`

### Redcliffe Labs
- **Postman Collection:** https://api.postman.com/collections/25836147-c45099eb-2f45-4e29-8a0f-d8da1e36c889
- **API Documentation:** https://docs.google.com/document/d/1aXpnbanPV8jDVXok7pp-a3_LmsUYLcWQJbqO7IcBJh4/edit?tab=t.p68vd7si2ak5#heading=h.rezsv2g3r6vz

---

## ⚠️ Important Notes

1. **Orange Health Endpoints:** All Orange Health Phase 2, 3, and 4 endpoints use placeholder paths and need verification against API documentation.

2. **Authentication:** 
   - Redcliffe uses `key` header
   - Orange uses `api_key` header

3. **OrderId Format:** Redcliffe uses numeric `booking_id`, but our system uses string `orderId`. Always convert with validation.

4. **Testing:** Always test with actual partner API (sandbox/mock) to verify all mappings work correctly.

---

## 🚀 Next Steps

1. **Priority 1:** Verify all Orange Health endpoints against API documentation
2. **Priority 2:** Update endpoint paths in Orange adapter if they differ
3. **Priority 3:** Test updated endpoints with Orange Health sandbox API
4. **Future:** Implement webhooks when ready

---

**Last Updated:** All implementation complete except endpoint verification and webhooks  
**Focus:** Only pending items are documented here
