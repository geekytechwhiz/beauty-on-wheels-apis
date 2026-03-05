# SSO Integration Plan - Doctor and Patient Creation

## Overview

**Region: South Africa**

This document outlines the plan for implementing SSO integration
that: 1. Verifies launch tokens from HMS (Hospital Management System) 2.
Fetches doctor details from HMS appointments API 3. Creates doctors and
patients in our system based on HMS data

**Note:** This integration is configured for South Africa region with
appropriate defaults (phone codes, date formats, etc.)

## Key Architectural Decisions

### Synchronous vs Asynchronous Processing

1.  **Doctor Creation: SYNCHRONOUS (Blocking)**
    -   ✅ Must complete before proceeding
    -   ✅ Wait for response
    -   ✅ Fail entire flow if doctor creation fails
    -   ✅ Need doctor ID for patient assignment
2.  **Patient Creation: ASYNCHRONOUS (Non-Blocking)**
    -   ✅ Fire and forget - don't wait for response
    -   ✅ Process in background (SQS queue + Lambda worker)
    -   ✅ Launch flow returns immediately
    -   ✅ Bulk processing - handle multiple patients concurrently
    -   ✅ Retry mechanism for failed creations
    -   ✅ No impact on launch flow if patient creation fails

**Rationale:** - Doctor is critical for session creation - Patients can
be many (bulk processing needed) - Don't want to block user login
waiting for all patients - Patients can be created/updated later if
needed

## Current State

### Existing Components

1.  **HMS Adapter** (`src/services/hms.adapter.ts`)
    -   ✅ `verifyLaunchToken()` - POST `/api/teleconsultation/verify`
    -   ✅ `getTodaysAppointments()` - POST
        `/api/teleconsultation/todays-appointments`
    -   ✅ `getPatientEMRSummary()` - POST
        `/api/teleconsultation/patient-emr-summary`
2.  **User Service Client** (`src/services/user.client.ts`)
    -   ✅ `findByExternalId()` - Lookup existing users
    -   ✅ `createUser()` - Basic user creation (needs enhancement)
3.  **Teleconsultation Claim** (`src/claims/teleconsultation.claim.ts`)
    -   ✅ Fetches appointments and EMR summaries

### Missing Components

1.  **Launch Service** - Referenced but not implemented
2.  **Doctor Creation Logic** - Need to map HMS doctor data to our
    doctor structure
3.  **Patient Creation Logic** - Need to map HMS patient data to our
    patient structure
4.  **Configuration File** - For default values not present in HMS data

## Integration Flow

    ┌─────────────────────────────────────────────────────────────────┐
    │ 1. SSO Launch Request                                          │
    │    GET /sso/launch?launch_token=<token>                        │
    └────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │ 2. Verify Launch Token                                          │
    │    POST /api/teleconsultation/verify                           │
    │    Request: { launch_token: "..." }                            │
    │    Response: {                                                  │
    │      status: "success",                                         │
    │      doctor_uid: 4,                                             │
    │      context: {                                                 │
    │        id: 9,                                                  │
    │        drid: 4,                                                │
    │        name: "ABDUL RASHID AHMED",                              │
    │        email: "abdul@hms.com"                                   │
    │      }                                                          │
    │    }                                                            │
    └────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │ 3. Fetch Today's Appointments                                   │
    │    GET /doctor/appointments/today                               │
    │    Request: { doctor_id: 4 }                                    │
    │    Response: {                                                  │
    │      status: "success",                                         │
    │      appointments: [                                             │
    │        {                                                        │
    │          appointment_id: 64,                                    │
    │          doctor: {                                              │
    │            id: 4,                                               │
    │            name: "ABDUL RASHID AHMED",                          │
    │            department: "GENERAL DOCTORS",                       │
    │            phone: "++++++++++0372807",                          │
    │            email: "abdul@hms.com"                               │
    │          },                                                     │
    │          patient: { ... }                                       │
    │        }                                                        │
    │      ]                                                          │
    │    }                                                            │
    └────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │ 4. Check if Doctor Exists in Our System                        │
    │    - Lookup by external_id (doctor_uid from HMS)              │
    │    - Provider: "HMS"                                           │
    │    - Tenant ID: from context or config                          │
    └────────────────────┬────────────────────────────────────────────┘
                         │
             ┌───────────┴───────────┐
             │                       │
             ▼                       ▼
        ┌─────────┐            ┌──────────┐
        │ EXISTS  │            │ NOT EXIST│
        └────┬────┘            └────┬─────┘
             │                      │
             │                      ▼
             │         ┌──────────────────────────────┐
             │         │ 5. Create Doctor (SYNC)      │
             │         │    ⏳ WAIT FOR RESPONSE      │
             │         │    POST /user                 │
             │         │    Body: {                    │
             │         │      userInfo: {              │
             │         │        name: "firstname last", │
             │         │        namePrefix: "Dr",       │
             │         │        contact: {              │
             │         │          email: "...",         │
             │         │          phone: "...",        │
             │         │          phoneCode: "+27"     │
             │         │        },                      │
             │         │        workingHours: {...},     │
             │         │        specialty: "...",        │
             │         │        slotDurationInMinutes: 15│
             │         │      },                        │
             │         │      userRole: ["<role-id>"],  │
             │         │      userType: "STAFF",       │
             │         │      organizationID: "..."    │
             │         │    }                           │
             │         │    ✅ Get doctor user ID      │
             │         └──────────────┬─────────────────┘
             │                        │
             └────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │ 6. Queue Patients for Bulk Creation (ASYNC)                     │
    │    🚀 FIRE AND FORGET - DON'T WAIT                              │
    │    - Extract unique patients from appointments                 │
    │    - Queue patient creation jobs (SQS/Lambda async)            │
    │    - Each patient creation runs in background                   │
    │    - No blocking - proceed immediately                         │
    │                                                                 │
    │    Queue Message: {                                             │
    │      patient: { id, name, email, phone, ... },                  │
    │      doctorId: "<doctor-user-id>",                              │
    │      organizationID: "...",                                    │
    │      correlationId: "..."                                      │
    │    }                                                            │
    └────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │ 7. Create Session & Return Response (IMMEDIATE)                │
    │    - Generate Cognito tokens                                    │
    │    - Return redirect URL with session token                     │
    │    - Don't wait for patient creation                            │
    └─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │ 8. Background: Patient Creation (ASYNC)                       │
    │    🔄 Running in separate thread/process                        │
    │    For each patient in queue:                                   │
    │    - Check if patient exists (by external_id)                 │
    │    - If not exists, create patient                              │
    │    POST /user                                                    │
    │    Body: {                                                      │
    │      userType: "USER",                                         │
    │      invite: "phone",                                          │
    │      userRole: ["<patient-role-id>"],                          │
    │      userInfo: {                                                │
    │        assignDoctor: {                                          │
    │          name: "Dr. Name",                                      │
    │          doctorId: "<doctor-user-id>"                          │
    │        },                                                       │
    │        name: "patient name",                                    │
    │        dateOfBirth: "27-02-2004",                              │
    │        gender: "Male",                                          │
    │        contact: {                                               │
    │          email: "...",                                          │
    │          phone: "...",                                         │
    │          phoneCode: "+27"                                       │
    │        }                                                        │
    │      }                                                          │
    │    }                                                            │
    │    - Log success/failure (don't block main flow)               │
    └─────────────────────────────────────────────────────────────────┘

## Data Mapping

### Doctor Mapping (HMS → Our System)

  ------------------------------------------------------------------------------------------
  HMS Field             Our System Field                   Notes
  --------------------- ---------------------------------- ---------------------------------
  `context.name`        `userInfo.name`                    Split into firstname/lastname if
                                                           needed

  `context.email`       `userInfo.contact.email`           Required for STAFF

  `doctor.phone`        `userInfo.contact.phone`           Clean phone number

  `doctor.department`   `userInfo.specialty`               Map department to specialty

  `doctor.department`   `userInfo.department`              Keep as-is

  \-                    `userInfo.namePrefix`              Default: "Dr" (from config)

  \-                    `userInfo.licenseNumber`           Default: "" (from config)

  \-                    `userInfo.workingHours`            Default: All days 07:00-21:00
                                                           (from config)

  \-                    `userInfo.slotDurationInMinutes`   Default: 15 (from config)

  \-                    `userInfo.bio`                     Default: "" (from config)

  \-                    `userInfo.contact.phoneCode`       Default: "+27" (South Africa)
                                                           (from config)

  \-                    `userRole`                         Default:
                                                           \["`<doctor-role-id>`{=html}"\]
                                                           (from config)

  \-                    `userType`                         "STAFF"

  \-                    `organizationID`                   From config or context
  ------------------------------------------------------------------------------------------

### Patient Mapping (HMS → Our System)

  -------------------------------------------------------------------------------------------
  HMS Field             Our System Field                   Notes
  --------------------- ---------------------------------- ----------------------------------
  `patient.name`        `userInfo.name`                    Full name

  `patient.email`       `userInfo.contact.email`           Optional

  `patient.phone`       `userInfo.contact.phone`           Required if no email

  `patient.gender`      `userInfo.gender`                  "Male" / "Female"

  `patient.dob`         `userInfo.dateOfBirth`             Format: "DD-MM-YYYY" (South Africa
                                                           format)

  `patient.age`         \-                                 Parse to calculate DOB if needed

  `patient.mrn`         \-                                 Store as external reference

  \-                    `userInfo.namePrefix`              Default: "Mr" / "Ms" (from gender)

  \-                    `userInfo.contact.phoneCode`       Default: "+27" (South Africa)
                                                           (from config)

  \-                    `userInfo.assignDoctor`            From appointment doctor

  \-                    `userInfo.emergencyContact`        Default: {} (from config)

  \-                    `userInfo.friendNFamily`           Default: {} (from config)

  \-                    `userInfo.medicalHistory`          Default: { allergies: \[\],
                                                           chronicDiseases: \[\], symptoms:
                                                           \[\] }

  \-                    `userRole`                         Default:
                                                           \["`<patient-role-id>`{=html}"\]
                                                           (from config)

  \-                    `userType`                         "USER"

  \-                    `invite`                           "phone"

  \-                    `organizationID`                   From config or context
  -------------------------------------------------------------------------------------------

## Configuration File Structure

Create `src/config/sso-config.ts`:

``` typescript
export interface SSOConfig {
  // Default organization ID for HMS users
  defaultOrganizationID: string;
  
  // Default role IDs
  doctorRoleId: string;
  patientRoleId: string;
  
  // Default doctor values
  doctor: {
    namePrefix: string; // "Dr"
    licenseNumber: string; // "" or default
    slotDurationInMinutes: number; // 15
    bio: string; // ""
    workingHours: {
      // Default working hours for all days
      available: boolean; // true
      availableHours: Array<{
        from: string; // "07:00"
        to: string; // "21:00"
      }>;
    };
  };
  
  // Default patient values
  patient: {
    phoneCode: string; // "+27" (South Africa)
    emergencyContact: {
      name: string;
      relation: string;
      phone: string;
      phoneCode: string;
      email: string;
    };
    friendNFamily: {
      name: string;
      relation: string;
      phone: string;
      phoneCode: string;
      email: string;
    };
    medicalHistory: {
      allergies: never[];
      chronicDiseases: never[];
      symptoms: never[];
    };
  };
  
  // Phone code mapping (if HMS provides country codes)
  phoneCodeMapping: Record<string, string>;
  
  // Department to Specialty mapping
  departmentToSpecialtyMapping: Record<string, string>;
}
```

## Implementation Tasks

### Task 1: Create Configuration File

-   [ ] Create `src/config/sso-config.ts`
-   [ ] Define SSOConfig interface
-   [ ] Load config from environment variables or JSON file
-   [ ] Add validation
-   [ ] Set South Africa defaults (phone code: +27, timezone:
    Africa/Johannesburg)

### Task 2: Create Doctor Mapper Service

-   [ ] Create `src/services/doctor.mapper.ts`
-   [ ] Implement `mapHMSDoctorToOurSystem()` function
-   [ ] Handle missing fields with config defaults
-   [ ] Parse name into firstname/lastname if needed
-   [ ] Clean phone numbers

### Task 3: Create Patient Mapper Service

-   [ ] Create `src/services/patient.mapper.ts`
-   [ ] Implement `mapHMSPatientToOurSystem()` function
-   [ ] Handle missing fields with config defaults
-   [ ] Format date of birth
-   [ ] Set name prefix based on gender

### Task 4: Enhance User Service Client

-   [ ] Update `createUser()` to support full doctor structure
-   [ ] Update `createUser()` to support full patient structure
-   [ ] Add error handling for duplicate users
-   [ ] Add retry logic for transient failures

### Task 5: Create Launch Service

-   [ ] Create `src/services/launch.service.ts`
-   [ ] Implement `processLaunch()` method:
    -   Verify launch token
    -   Fetch appointments
    -   Check/create doctor (SYNCHRONOUS - wait for response)
    -   Queue patients for bulk creation (ASYNCHRONOUS - fire and
        forget)
    -   Create session (don't wait for patient creation)
-   [ ] Implement `formatResponse()` method

### Task 5a: Create Patient Queue Service

-   [ ] Create `src/services/patient-queue.service.ts`
-   [ ] Implement queue mechanism (SQS or Lambda async invocation)
-   [ ] Queue patient creation jobs in bulk
-   [ ] Don't wait for completion
-   [ ] Handle queue failures gracefully

### Task 5b: Create Patient Background Worker

-   [ ] Create `src/handlers/patient-creation-worker.ts` (Lambda
    handler)
-   [ ] Process patient creation from queue
-   [ ] Check if patient exists before creating
-   [ ] Create patient via User Service
-   [ ] Log results (success/failure)
-   [ ] Handle retries for failed creations

### Task 6: Update HMS Adapter

-   [ ] Update `getTodaysAppointments()` to use GET method
-   [ ] Update endpoint to `/doctor/appointments/today`
-   [ ] Handle new response structure

### Task 7: Integration Testing

-   [ ] Test doctor creation flow (synchronous)
-   [ ] Test patient queue creation (asynchronous)
-   [ ] Test patient background worker
-   [ ] Test duplicate user handling (doctor and patient)
-   [ ] Test error scenarios:
    -   Doctor creation failure (should block)
    -   Patient queue failure (should not block)
    -   Patient creation failure in background (should retry)
-   [ ] Test bulk patient processing (multiple patients)
-   [ ] Test launch flow doesn't wait for patient creation

## API Endpoints to Update

### HMS Adapter - Get Today's Appointments

**Current:**

``` typescript
POST /api/teleconsultation/todays-appointments
{ doctor_id: number }
```

**Should be:**

``` typescript
GET /doctor/appointments/today?doctor_id=123
```

**Note:** Based on user's specification, it should be GET with query
parameter, but the example shows POST with body. Need to confirm with
user.

## Asynchronous Patient Processing Architecture

### Design Decision

-   **Doctor Creation**: Synchronous (blocking) - Must complete before
    proceeding
-   **Patient Creation**: Asynchronous (non-blocking) - Fire and forget,
    process in background

### Implementation Options

#### Option 1: AWS SQS Queue (Recommended)

    Launch Flow → Queue Patient Jobs → Return Response
                    ↓
             SQS Queue
                    ↓
        Patient Worker Lambda
        (Processes in background)

**Pros:** - Reliable delivery - Built-in retry mechanism - Dead letter
queue for failed messages - Scalable (handles bulk processing)

**Cons:** - Requires SQS setup - Additional infrastructure

#### Option 2: Lambda Async Invocation

    Launch Flow → Invoke Lambda Async → Return Response
                    ↓
        Patient Creation Lambda
        (Runs independently)

**Pros:** - Simple implementation - No additional infrastructure - AWS
handles retries

**Cons:** - Less control over retries - No dead letter queue by default

#### Option 3: Background Thread (Node.js)

    Launch Flow → Spawn Background Thread → Return Response
                    ↓
        Background Thread
        (Processes patients)

**Pros:** - No additional infrastructure - Fast implementation

**Cons:** - Lambda timeout limits - No persistence if Lambda dies - Not
recommended for production

### Recommended: SQS Queue Approach

**Queue Structure:**

``` typescript
interface PatientCreationMessage {
  patient: {
    id: number;
    name: string;
    email?: string;
    phone?: string;
    gender: string;
    dob?: string;
    mrn?: string;
  };
  doctorId: string; // Our system's doctor user ID
  organizationID: string;
  tenantId: string;
  correlationId: string;
  retryCount?: number;
}
```

**Flow:** 1. Launch service extracts unique patients from appointments
2. Creates SQS messages for each patient 3. Sends messages to queue
(fire and forget) 4. Returns response immediately (doesn't wait) 5.
Background worker processes queue messages 6. Each patient creation is
independent

## Error Handling

1.  **Doctor Already Exists**
    -   Lookup by external_id
    -   If exists, use existing doctor
    -   Log warning but continue
    -   **BLOCKING**: Must resolve before proceeding
2.  **Doctor Creation Failure**
    -   **BLOCKING**: Fail the entire launch flow
    -   Return error to user
    -   Log detailed error information
3.  **Patient Queue Failure**
    -   **NON-BLOCKING**: Log error but don't fail launch
    -   Retry queue send operation
    -   If queue unavailable, log and continue
    -   Launch flow succeeds even if queue fails
4.  **Patient Creation Failure (Background)**
    -   **NON-BLOCKING**: Doesn't affect launch flow
    -   Log error in background worker
    -   Retry via SQS retry mechanism
    -   Send to dead letter queue after max retries
    -   Alert/monitor for failed patient creations
5.  **Patient Already Exists (Background)**
    -   Lookup by external_id in background worker
    -   If exists, skip creation
    -   Log info message
    -   Update assignDoctor if needed
6.  **Missing Required Fields**
    -   Use config defaults
    -   Log warnings for missing critical fields
    -   For doctor: Fail if critical fields missing
    -   For patient: Use defaults, log warning, continue
7.  **HMS API Failures**
    -   Retry with exponential backoff
    -   Return appropriate error codes
    -   Log detailed error information
    -   **Doctor fetch failure**: Block launch
    -   **Patient fetch failure**: Log and continue (patients in queue)

## Security Considerations

1.  **External ID Validation**
    -   Ensure external_id is unique per provider+tenant
    -   Prevent ID injection attacks
2.  **Data Sanitization**
    -   Sanitize all user inputs
    -   Validate email/phone formats
    -   Prevent XSS in names
3.  **Rate Limiting**
    -   Already implemented in middleware
    -   Ensure doctor/patient creation respects limits

## Testing Strategy

1.  **Unit Tests**
    -   Test mapper functions
    -   Test config loading
    -   Test error handling
2.  **Integration Tests**
    -   Test full launch flow
    -   Test with mock HMS responses
    -   Test duplicate scenarios
3.  **End-to-End Tests**
    -   Test with real HMS (sandbox)
    -   Verify doctor/patient creation
    -   Verify session creation

## Next Steps

1.  Review and approve this plan
2.  Create configuration file structure
3.  Implement mapper services
4.  Implement launch service
5.  Update HMS adapter if needed
6.  Add comprehensive tests
7.  Deploy to dev environment
8.  Test with HMS sandbox
9.  Deploy to staging/production

## South Africa Specific Configuration

### Phone Codes

-   **Default Phone Code**: `+27` (South Africa)
-   **Phone Number Cleaning**: HMS shows phone numbers like
    "++++++++++0372807"
    -   Remove all "+" characters
    -   If number starts with "0", replace with "+27"
    -   If number doesn't start with "0" or "+27", prepend "+27"
    -   Example: "++++++++++0372807" → "+270372807"
    -   Example: "1234567890" → "+271234567890"

### Date Formats

-   **Input Format**: ISO 8601 (from HMS):
    `"2026-02-25T10:00:00.000000Z"`
-   **Output Format**: `"DD-MM-YYYY"` (e.g., "25-02-2026")
-   **Date of Birth**: Parse from ISO format and convert to DD-MM-YYYY

### Regional Defaults

-   **Country Code**: `ZAF` (South Africa)
-   **Time Zone**: `Africa/Johannesburg` (SAST - UTC+2)
-   **Currency**: ZAR (if needed)

## Questions to Resolve

1.  **Appointments API Method**: GET vs POST? User specified GET but
    example shows POST body.
2.  **Organization ID**: Should it come from HMS context or always from
    config?
3.  **Doctor Role ID**: How to determine which role ID to use? From
    config or lookup?
4.  **Patient Role ID**: Same as above.
5.  **Phone Number Format**: HMS shows "++++++++++0372807" - how to
    clean this? (South Africa format: +27XXXXXXXXX)
6.  **Date Format**: HMS uses ISO format, we need "DD-MM-YYYY" -
    confirmed for South Africa.
7.  **Department to Specialty**: Need mapping table or use department
    as-is?
8.  **South Africa Organization ID**: Which organization ID should be
    used for South Africa HMS integration?

## References

-   User Service API:
    `api-hub/apps/user-service/src/services/user.service.ts`
-   User Validation:
    `api-hub/apps/user-service/src/validation/user.validation.ts`
-   HMS Adapter:
    `api-hub/services/sso-integration/src/services/hms.adapter.ts`
-   Types: `api-hub/services/sso-integration/src/types/index.ts`

------------------------------------------------------------------------

# ENTERPRISE ARCHITECTURE UPDATES (HIGHLIGHTED)

## [1. Launch Idempotency (MANDATORY)]{style="color:red; font-weight:bold;"}

-   Create LaunchSession table with PK: launchToken
-   If launchToken already processed → return existing session
-   Prevent replay attacks and duplicate doctor/patient creation

## [2. Multi-Tenant Safe Lookup (CRITICAL)]{style="color:red; font-weight:bold;"}

-   All user lookups MUST use (provider, external_id, tenantId)
-   Enforce UNIQUE(provider, external_id, tenantId) at database level

## [3. Organization Resolution Update]{style="color:red; font-weight:bold;"}

-   REMOVE organizationID from config fallback
-   ADD IntegrationMapping table: (provider, hmsTenantId) →
    organizationId

## [4. Date Storage Correction]{style="color:red; font-weight:bold;"}

-   DO NOT store DD-MM-YYYY
-   Store ISO format: YYYY-MM-DD
-   Format only at UI layer

## [5. Phone Normalization Correction]{style="color:red; font-weight:bold;"}

-   Do NOT remove all "+" blindly
-   Normalize safely:
    -   If starts with 0 → replace with +27
    -   If starts with 27 → prefix +
    -   Validate number length
    -   Log invalid numbers (do not block launch)

## [6. Event-Driven Enhancement]{style="color:red; font-weight:bold;"}

-   Replace direct SQS queueing with: EventBridge → PatientExtraction
    Lambda → SQS → Worker
-   Enables analytics, audit, notifications

## [7. Patient Upsert Safety Rule]{style="color:red; font-weight:bold;"}

-   If patient exists:
    -   Assign doctor only if not already assigned
    -   Do NOT overwrite manual assignments

## [8. Audit Logging (Healthcare Requirement)]{style="color:red; font-weight:bold;"}

-   Log DoctorCreatedViaSSO
-   Log PatientUpsertViaSSO
-   Include provider, timestamp, organizationId

## [9. Observability Additions]{style="color:red; font-weight:bold;"}

-   Add correlationId across flow
-   Add CloudWatch metrics:
    -   DoctorCreatedCount
    -   PatientUpsertSuccessCount
    -   DLQCount
    -   LaunchReplayDetected

------------------------------------------------------------------------
