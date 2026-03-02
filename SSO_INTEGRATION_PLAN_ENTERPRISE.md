
# SSO Integration Plan - Doctor and Patient Creation (Enterprise Version)

## Overview

**Region: South Africa (Multi-Region Ready)**

This document outlines the enterprise-grade plan for implementing SSO integration that:

1. Verifies launch tokens from HMS
2. Fetches doctor and appointment details
3. Idempotently creates/updates doctors
4. Asynchronously upserts patients
5. Prevents replay attacks and duplication
6. Supports multi-tenant and multi-country expansion

---

# 🔐 Enterprise Enhancements Added

## 1. Launch Idempotency (NEW - Mandatory)

Before processing launch:

Check LaunchSession table:

- PK: launchToken
- doctorExternalId
- doctorUserId
- organizationId
- status
- createdAt

If launchToken already processed:
→ Return existing session  
→ DO NOT reprocess doctor/patients

Prevents:
- Replay attacks
- Duplicate doctors
- Duplicate patient queueing

---

## 2. Multi-Tenant Safe Identity Model

All lookups MUST use:

(provider, external_id, tenantId)

User Service MUST enforce unique constraint:

UNIQUE(provider, external_id, tenantId)

---

# Key Architectural Decisions

## Doctor Creation – SYNCHRONOUS (Blocking + Idempotent)

- Must complete before session creation
- Race-condition safe
- Duplicate-safe
- Fail launch if doctor creation fails

## Patient Creation – ASYNCHRONOUS (Event-Driven + Idempotent)

- Fire and forget
- Process via EventBridge → SQS → Lambda Worker
- Safe for retries
- No impact on launch flow

---

# Updated Integration Flow

1. GET /sso/launch?launch_token=XYZ
2. Check LaunchSession table
   - If exists → return session
   - If not → continue
3. Verify Launch Token via HMS
4. Resolve Organization via IntegrationMapping table
5. Fetch Today’s Appointments
6. Doctor Upsert (Idempotent)
7. Save LaunchSession record
8. Publish Event → DoctorLaunchCompleted
9. Generate Cognito Session and return response

---

# Asynchronous Boundary

DoctorLaunchCompleted Event
        ↓
PatientExtraction Lambda
        ↓
SQS: patient-upsert-queue
        ↓
PatientUpsertWorker Lambda

---

# Data Mapping Updates

## Doctor Mapping

- Store full name
- Normalize & validate phone
- Specialty via mapping table
- Organization resolved via IntegrationMapping

## Patient Mapping

- Store DOB in ISO format (YYYY-MM-DD)
- Format to DD-MM-YYYY only in UI
- Persist MRN in externalReferences
- Do NOT overwrite existing doctor assignment blindly

---

# South Africa Configuration (Updated)

Phone Handling:
1. Remove non-digit characters except leading +
2. If starts with 0 → replace with +27
3. If starts with 27 → prefix +
4. Validate number length

Date Storage:
- Store ISO (YYYY-MM-DD)
- Display formatted per locale

Timezone: Africa/Johannesburg  
Currency: ZAR

---

# Observability & Audit (NEW)

Add structured logs with:

- correlationId
- provider
- externalDoctorId
- externalPatientId
- tenantId

Metrics:
- DoctorCreatedCount
- PatientUpsertSuccessCount
- PatientDLQCount
- LaunchReplayDetected

Audit Events:
- DoctorCreatedViaSSO
- PatientUpsertViaSSO

---

# Additional Required Tables

1. LaunchSession (Replay Protection)
2. IntegrationMapping (provider → organizationId)

---

# Security Enhancements

- Strict field whitelisting
- Unique identity enforcement
- Replay protection
- Structured audit logging

---

# Final Result

This version is:

✓ Replay safe  
✓ Multi-tenant safe  
✓ Event-driven  
✓ Idempotent  
✓ Healthcare compliant  
✓ Scalable for multi-country expansion  

