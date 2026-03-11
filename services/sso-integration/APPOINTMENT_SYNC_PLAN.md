# Appointment Sync and Schedule Creation Flow - Implementation Plan

## Overview

This document outlines the comprehensive plan for implementing the appointment synchronization and schedule creation flow in the SSO integration service. The flow synchronizes appointments from external systems (TruTech) into our internal schedule system.

## Current State Analysis

### Existing Components (Comprehensive Review)

1. **AppointmentsService** (`src/services/appointments.service.ts`)
   - ✅ `getTodaysAppointments()` - Fetches today's appointments from external system
   - ✅ `getPatientEMRSummary()` - Fetches patient EMR summary
   - ✅ `formatAppointmentsResponse()` - Formats response
   - ✅ `formatEMRResponse()` - Formats EMR response
   - ✅ Empty appointment handling (returns success if empty array)
   - ✅ Error handling with SSOError
   - ✅ Performance logging with timers

2. **UserServiceClient** (`src/clients/user.client.ts`)
   - ✅ `findByExternalId()` - Validates patient/doctor existence by external ID
   - ✅ `createUser()` - Basic user creation
   - ✅ `createPatient()` - Creates patient users with full payload
   - ✅ `createDoctor()` - Creates doctor users with full payload
   - ✅ Error handling (404 returns null, other errors throw SSOError)
   - ✅ Axios interceptors for logging

3. **TruTechClient** (`src/clients/tru-tech.clients.ts`)
   - ✅ `verifyLaunchToken()` - Verifies launch token from TruTech
   - ✅ `getTodaysAppointments()` - Fetches appointments from TruTech API
   - ✅ `getPatientEMRSummary()` - Fetches patient EMR from TruTech
   - ✅ Error handling with proper SSOError mapping
   - ✅ Request/response interceptors

4. **TruTechAdapter** (`src/adapters/trutech.adapter.ts.ts`)
   - ✅ `mapVerifyResponse()` - Maps verification response
   - ✅ `mapAppointments()` - Maps external appointments to internal format
   - ✅ `mapPatientEMRSummary()` - Maps EMR data
   - ✅ `normalizeAppointment()` - Normalizes appointment data
   - ✅ `normalizeEMRVisit()` - Normalizes EMR visit data

5. **LaunchService** (`src/services/launch.service.ts`)
   - ✅ `processLaunch()` - Main launch orchestration
   - ✅ `ensureDoctorExists()` - Validates/creates doctor (uses Cognito + UserService)
   - ✅ `fetchAppointments()` - Fetches appointments
   - ✅ `publishPatientCreationEvents()` - Publishes patient events
   - ✅ `generateServiceToken()` - Generates service tokens
   - ⚠️ **Note:** Doctor validation uses Cognito first, then UserService. For appointment sync, should use `findByExternalId()` directly.

6. **Patient Event Consumer** (`src/handlers/events/patient-creation-event-consumer.ts`)
   - ✅ Processes patient creation events from SQS
   - ✅ Handles patient creation in background
   - ✅ Checks if patient already exists before creating
   - ✅ Error handling and retry mechanism (via SQS batch failures)
   - ⚠️ **Note:** Currently commented out in serverless.yml but code is fully implemented

7. **Patient Event Publisher** (`src/services/patient-event-publisher.service.ts`)
   - ✅ `publishPatientCreationEvent()` - Publishes single event
   - ✅ `publishPatientCreationEventsBatch()` - Publishes batch events
   - ✅ `createPatientCreationEvent()` - Creates event structure
   - ✅ Non-blocking error handling

8. **Mappers and Helpers**
   - ✅ **Doctor Mapper** (`src/mappers/create-doctor.mapper.ts` & `src/helper/doctor.mapper.ts`)
     - ✅ `mapTruTechDoctorToOurSystem()` - Maps doctor data
   - ✅ **Patient Mapper** (`src/helper/patient.mapper.ts`)
     - ✅ `mapTruTechPatientToOurSystem()` - Maps patient data
   - ✅ **Launch Response Mapper** (`src/mappers/launch-response.mapper.ts`)
     - ✅ `mapLaunchResponse()` - Maps launch response

9. **Configuration**
   - ✅ **Env Config** (`src/config/env.ts`)
     - ✅ Zod schema validation
     - ✅ Environment variable loading
     - ✅ Caching
   - ✅ **SSO Config** (`src/config/sso-config.ts`)
     - ✅ Default organization ID
     - ✅ Role IDs (doctor, patient)
     - ✅ Doctor defaults (specialty, working hours, etc.)
     - ✅ Patient defaults (phone code, emergency contact, etc.)

10. **Utilities**
    - ✅ **Phone Processor** (`src/utils/phone-processor.ts`)
      - ✅ `processPhoneNumber()` - Extracts phone code from phone number
      - ✅ `isValidPhoneNumber()` - Validates phone format

11. **Types and Interfaces** (`src/types/`)
    - ✅ `Appointment` interface with all required fields
    - ✅ `TruTechAppointment` interface matching external API response
    - ✅ `TruTechPatient`, `TruTechDoctor`, `TruTechConsultationType`, `TruTechVisit`
    - ✅ `PatientCreationEvent` interface
    - ✅ `DoctorCreationPayload`, `PatientCreationPayload`
    - ✅ `AppointmentStatus`, `VisitType`, `VisitStatus` enums
    - ✅ `SSOErrorCode` enum
    - ✅ All domain types in `src/types/domain/`

12. **Error Handling**
    - ✅ **SSOError** (`src/types/errors/sso-error.ts`)
      - ✅ Comprehensive error class with static factory methods
      - ✅ Error codes, status codes, and cause tracking

13. **Infrastructure**
    - ✅ **BaseService** (`src/core/base.service.ts`) - Base service class
    - ✅ **BaseController** (`src/core/base.controller.ts`) - Base controller class
    - ✅ **HTTP Handlers** - `appointments.ts`, `patient-emr.ts`, `sso-launch.ts`
    - ✅ **Controllers** - `appointments.controller.ts`, `sso.controller.ts`
    - ✅ **Validators** - `sso.validator.ts`
    - ✅ **Middleware** - `rate-limit.middleware.ts`, `service-token.middleware.ts`

14. **Serverless Configuration** (`serverless.yml`)
    - ✅ `GET /appointments/today` - Get today's appointments
    - ✅ `GET /appointments/{patientId}/emr` - Get patient EMR
    - ✅ `GET /sso/launch` - SSO launch endpoint
    - ✅ Health check endpoint
    - ⚠️ Patient event consumer commented out (SQS queue disabled)

### Missing Components (For Appointment Sync)

1. **Schedule Service Client** (`src/clients/schedule-service.client.ts`) - ❌ NOT IMPLEMENTED
   - For calling internal schedule APIs (fetch, create, update)

2. **Appointment Sync Service** (`src/services/appointment-sync.service.ts`) - ❌ NOT IMPLEMENTED
   - Orchestrates the entire sync flow

3. **Appointment to Schedule Mapper** (`src/mappers/appointment.mapper.ts`) - ❌ NOT IMPLEMENTED
   - Maps external appointment to internal schedule format

4. **Pending Appointment Storage** - ❌ NOT IMPLEMENTED
   - For tracking appointments with missing patients

5. **Retry Mechanism** - ❌ NOT IMPLEMENTED
   - For handling failed operations with exponential backoff

6. **Idempotency Check** - ❌ NOT IMPLEMENTED
   - For duplicate appointment prevention using externalAppointmentId

7. **Appointment Sync API Endpoint** - ❌ NOT IMPLEMENTED
   - `POST /appointments/sync` handler and controller

8. **Appointment Sync Types** (`src/types/appointment-sync.types.ts`) - ❌ NOT IMPLEMENTED
   - Types for sync request, response, pending appointments, etc.

## Flow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Trigger Appointment Sync                                     │
│    POST /appointments/sync?doctorId=<id>                        │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Doctor Validation                                            │
│    - Fetch the doctor details from the myViatlrx DB             │
│    - If not exists: throw error (already implemented)           │
│    - If exists: return doctor details                           │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Fetch Today's Appointments                                   │
│    - Call external API (already implemented)                    │
│    - If empty array: return success (already implemented)       │
│    - If appointments exist: proceed to validation 
     - Fetch all patient details and procced to appoint or user
     creation          
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Push to SQS queue to Process Each Appointment                │
│    For each appointment:                                        │
│    ├
│    ├─ Check Duplicate Schedule through dynamoDB is_key exist with 
        appoinmentid(unique) Need to confirm                      │
│    ├─ Create Schedule Use idempotency key and status as ACCEPTED
      in schedule service. 
│                         
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Handle Pending Appointments                                  │
│    - Reprocess appointments marked as pending                   │
│    - Trigger after patient creation completes                   │
└─────────────────────────────────────────────────────────────────┘
```

## Detailed Implementation Plan

### Phase 1: Schedule Service Client

**File:** `src/clients/schedule-service.client.ts`

**Purpose:** Client for calling internal schedule service APIs

**Methods to Implement:**

1. **`fetchSchedules()`**
   - **Endpoint:** `POST /fetch/schedules`
   - **Purpose:** Check if appointment already exists
   - **Request:**
     ```typescript
     {
       fromDate: number, // timestamp
       toDate: number,   // timestamp
       organizationID: string
     }
     ```
   - **Response:** Array of schedules matching criteria
   - **Usage:** Check for duplicate appointments by doctor, patient, and time slot

2. **`createSchedule()`**
   - **Endpoint:** `POST /create/schedule`
   - **Purpose:** Create new schedule/appointment
   - **Request:**
     ```typescript
     {
       startTime: string,        // ISO 8601
       endTime: string,          // ISO 8601
       scheduleDate: string,     // YYYY-MM-DD
       appointmentType: "ONLINE",
       owner: {
         userId: string,
         userType: "STAFF"
       },
       participantInfo: [
         {
           userId: string,       // doctor userId
           userType: "STAFF",
           organizationID: string
         },
         {
           userId: string,       // patient userId
           userType: "USER",
           organizationID: string
         }
       ],
       organizationID: string,
       externalAppointmentId: string, // for idempotency
       meta?: {
         externalAppointmentId: string,
         consultationType?: string,
         visitId?: number
       }
     }
     ```
   - **Response:** Created schedule object with scheduleId

3. **`updateScheduleStatus()`**
   - **Endpoint:** `POST /update/schedule-status`
   - **Purpose:** Update appointment status to ACCEPTED
   - **Request:**
     ```typescript
     {
       scheduleId: string,
       status: "ACCEPTED",
       organizationID: string
     }
     ```
   - **Response:** Updated schedule object

**Configuration:**
- Base URL from environment: `SCHEDULE_SERVICE_API_URL`
- Timeout: 10 seconds (configurable)
- Retry: 3 attempts with exponential backoff

**Error Handling:**
- Network errors: Retry with backoff
- 404 errors: Return null/empty array (not found)
- 409 errors: Duplicate (idempotency check)
- 400 errors: Invalid request (log and skip)

---

### Phase 2: Appointment Mapper

**File:** `src/mappers/appointment.mapper.ts`

**Purpose:** Map external appointment data to internal schedule format

**Method:** `mapAppointmentToSchedule()`

**Mapping Logic:**

| External Field | Internal Field | Transformation |
|---------------|----------------|----------------|
| `appointment_id` | `externalAppointmentId` | Direct mapping |
| `start_time` | `startTime` | ISO 8601 format (already in correct format) |
| `end_time` | `endTime` | ISO 8601 format (already in correct format) |
| `start_time` (date part) | `scheduleDate` | Extract date: `YYYY-MM-DD` |
| `consultation_type.name` | `appointmentType` | Map to "ONLINE" |
| `doctor` | `owner` | Map doctor userId |
| `doctor` + `patient` | `participantInfo` | Array with doctor and patient |
| `patient.organizationId` | `organizationID` | Direct mapping |

**Example Mapping:**

```typescript
// Input: TruTech Appointment
{
  appointment_id: 64,
  start_time: "2026-02-25T10:00:00.000000Z",
  end_time: "2026-02-25T10:15:00.000000Z",
  doctor: { id: 4, name: "Dr. Name", ... },
  patient: { id: 9, name: "Patient Name", organizationId: "org123", ... },
  consultation_type: { id: 1, name: "Online" }
}

// Output: Internal Schedule
{
  startTime: "2026-02-25T10:00:00.000000Z",
  endTime: "2026-02-25T10:15:00.000000Z",
  scheduleDate: "2026-02-25",
  appointmentType: "ONLINE",
  owner: {
    userId: "doctor-user-id",
    userType: "STAFF"
  },
  participantInfo: [
    {
      userId: "doctor-user-id",
      userType: "STAFF",
      organizationID: "org123"
    },
    {
      userId: "patient-user-id",
      userType: "USER",
      organizationID: "org123"
    }
  ],
  organizationID: "org123",
  externalAppointmentId: "64",
  meta: {
    externalAppointmentId: "64",
    consultationType: "Online",
    visitId: 123
  }
}
```

---

### Phase 3: Appointment Sync Service

**File:** `src/services/appointment-sync.service.ts`

**Purpose:** Orchestrates the entire appointment sync flow

**Main Method:** `syncAppointments()`

**Flow Implementation:**

```typescript
async syncAppointments(
  doctorId: number,
  correlationId: string
): Promise<AppointmentSyncResult> {
  // 1. Validate Doctor
  const doctor = await this.validateDoctor(doctorId, correlationId);
  
  // 2. Fetch Today's Appointments
  const appointments = await this.appointmentsService.getTodaysAppointments(
    doctorId,
    correlationId
  );
  
  // 3. Handle Empty Appointments
  if (appointments.length === 0) {
    return {
      message: "No appointments found for today",
      totalAppointments: 0,
      status: "SUCCESS",
      synced: 0,
      skipped: 0,
      failed: 0,
      pending: 0
    };
  }
  
  // 4. Process Each Appointment
  const results = await this.processAppointments(
    appointments,
    doctor,
    correlationId
  );
  
  // 5. Return Summary
  return {
    message: "Appointment sync completed",
    totalAppointments: appointments.length,
    status: "SUCCESS",
    ...results
  };
}
```

**Helper Methods:**

1. **`validateDoctor()`**
   - Check if doctor exists using `UserServiceClient.findByExternalId()`
   - If not exists: throw `SSOError` with message "Doctor not found"
   - If exists: return doctor details

2. **`validatePatient()`**
   - Check if patient exists using `UserServiceClient.findByExternalId()`
   - If exists: return patient details
   - If not exists: return `null` (mark as pending)

3. **`checkDuplicateSchedule()`**
   - Call `ScheduleServiceClient.fetchSchedules()` with:
     - `fromDate`: appointment start time (timestamp)
     - `toDate`: appointment end time (timestamp)
     - `organizationID`: patient organization ID
   - Filter results by:
     - Doctor userId matches
     - Patient userId matches
     - Time slot overlaps
   - Return `true` if duplicate found, `false` otherwise

4. **`createSchedule()`**
   - Map appointment using `AppointmentMapper.mapAppointmentToSchedule()`
   - Call `ScheduleServiceClient.createSchedule()`
   - Handle errors:
     - 409 (duplicate): Skip and log
     - 400 (invalid): Log and skip
     - 500 (server error): Retry with backoff

5. **`updateScheduleStatus()`**
   - Call `ScheduleServiceClient.updateScheduleStatus()` with status "ACCEPTED"
   - Retry on failure (3 attempts)
   - Log success/failure

6. **`processAppointments()`**
   - Process appointments in parallel (with concurrency limit)
   - Track results: synced, skipped, failed, pending
   - Return summary

**Pending Appointment Handling:**

- Store pending appointments in memory/queue (for this sync session)
- After main flow completes, check if any patients were created
- Reprocess pending appointments if patient now exists

---

### Phase 4: Idempotency and Retry

**Idempotency Strategy:**

1. **Use `externalAppointmentId` as unique identifier**
   - Store in schedule `meta.externalAppointmentId`
   - Check before creating: query schedules by `externalAppointmentId`

2. **Duplicate Check Logic:**
   ```typescript
   async isDuplicateAppointment(
     externalAppointmentId: string,
     organizationID: string
   ): Promise<boolean> {
     // Option 1: Check in fetchSchedules response
     const schedules = await this.scheduleClient.fetchSchedules(...);
     return schedules.some(s => 
       s.meta?.externalAppointmentId === externalAppointmentId
     );
     
     // Option 2: Dedicated check endpoint (if available)
     // Call GET /schedules/by-external-id?externalId=...
   }
   ```

3. **Skip Logic:**
   - If duplicate found: Skip creation, log, return success
   - Response: `{ skipped: true, reason: "duplicate" }`

**Retry Strategy:**

1. **Retry Configuration:**
   ```typescript
   const RETRY_CONFIG = {
     maxAttempts: 3,
     initialDelayMs: 1000,
     maxDelayMs: 10000,
     backoffMultiplier: 2
   };
   ```

2. **Retry Scenarios:**
   - External API timeout → Retry fetch appointments
   - Schedule creation failed → Retry create schedule
   - Status update failed → Retry update status
   - Network errors → Retry with exponential backoff

3. **Retry Implementation:**
   ```typescript
   async retryWithBackoff<T>(
     operation: () => Promise<T>,
     maxAttempts: number = 3
   ): Promise<T> {
     let lastError: Error;
     for (let attempt = 1; attempt <= maxAttempts; attempt++) {
       try {
         return await operation();
       } catch (error) {
         lastError = error as Error;
         if (attempt < maxAttempts) {
           const delay = Math.min(
             RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1),
             RETRY_CONFIG.maxDelayMs
           );
           await sleep(delay);
         }
       }
     }
     throw lastError!;
   }
   ```

---

### Phase 5: Error Handling

**Error Scenarios and Handling:**

1. **Doctor Not Found**
   - **Scenario:** Doctor from external system doesn't exist internally
   - **Handling:**
     - Throw `SSOError.validationError("Doctor not found for doctorId: {id}")`
     - Skip appointment
     - Log error
     - Continue processing other appointments (if batch)

2. **Invalid Appointment Data**
   - **Scenario:** Missing required fields (appointment_id, start_time, patient, doctor)
   - **Handling:**
     - Validate appointment data before processing
     - Log error: "Invalid appointment payload received"
     - Skip appointment
     - Continue processing

3. **Duplicate Appointment**
   - **Scenario:** Appointment already exists in system
   - **Handling:**
     - Skip schedule creation
     - Log: "Appointment already synced. Skipping duplicate."
     - Return success (not an error)

4. **Patient Not Found**
   - **Scenario:** Patient doesn't exist internally
   - **Handling:**
     - Mark appointment with `pending: true` flag
     - Store appointment in pending queue
     - Trigger patient creation flow (if not already triggered)
     - Reprocess after patient creation completes

5. **Schedule Creation Failure**
   - **Scenario:** Create schedule API fails
   - **Handling:**
     - Retry API call (3 attempts with backoff)
     - If still failing:
       - Log error
       - Move appointment to retry queue
       - Return failure for this appointment
     - Continue processing other appointments

6. **Status Update Failure**
   - **Scenario:** Update schedule status API fails
   - **Handling:**
     - Retry API call (3 attempts)
     - If still failing:
       - Log error
       - Schedule created but status not updated
       - Consider this a partial success (schedule exists, status pending)

7. **External API Failure**
   - **Scenario:** External system appointment API fails
   - **Handling:**
     - Retry request (3 attempts)
     - If still failing:
       - Return `SSOError.downstreamError("Failed to fetch appointments")`
       - Fail entire sync operation

---

### Phase 6: Pending Appointment Reprocessing

**Implementation Strategy:**

1. **Store Pending Appointments:**
   ```typescript
   interface PendingAppointment {
     appointment: Appointment;
     reason: "patient_not_found";
     timestamp: string;
     retryCount: number;
   }
   ```

2. **After Main Flow:**
   - Check all pending appointments
   - For each pending appointment:
     - Re-validate patient existence
     - If patient now exists:
       - Process appointment (check duplicate, create schedule, update status)
     - If patient still missing:
       - Keep in pending queue
       - Increment retry count
       - Schedule retry later (or wait for patient creation event)

3. **Integration with Patient Creation Event:**
   - When patient creation event completes:
     - Trigger reprocessing of pending appointments for that patient
     - Use patient external ID to match pending appointments

4. **Reprocessing Logic:**
   ```typescript
   async reprocessPendingAppointments(
     patientExternalId: string,
     correlationId: string
   ): Promise<void> {
     const pendingAppointments = this.getPendingAppointmentsByPatient(
       patientExternalId
     );
     
     for (const pending of pendingAppointments) {
       try {
         await this.processAppointment(
           pending.appointment,
           correlationId
         );
         this.removePendingAppointment(pending);
       } catch (error) {
         // Log error, keep in pending queue
       }
     }
   }
   ```

---

### Phase 7: API Endpoint

**File:** `src/handlers/http/appointment-sync.ts`

**Endpoint:** `POST /appointments/sync`

**Request:**
- Query Parameter: `doctorId` (required)
- Headers: Authorization (JWT token)

**Response:**
```typescript
{
  success: true,
  data: {
    message: string,
    totalAppointments: number,
    status: "SUCCESS",
    synced: number,
    skipped: number,
    failed: number,
    pending: number,
    details?: {
      synced: string[],      // scheduleIds
      skipped: string[],     // externalAppointmentIds
      failed: string[],       // externalAppointmentIds
      pending: string[]      // externalAppointmentIds
    }
  }
}
```

**Empty Response:**
```typescript
{
  success: true,
  data: {
    message: "No appointments found for today",
    totalAppointments: 0,
    status: "SUCCESS"
  }
}
```

**Error Response:**
```typescript
{
  success: false,
  error: {
    code: string,
    message: string,
    requestId: string
  }
}
```

---

### Phase 8: Types and Interfaces

**File:** `src/types/appointment-sync.types.ts`

**New Types:**

```typescript
export interface AppointmentSyncRequest {
  doctorId: number;
}

export interface AppointmentSyncResult {
  message: string;
  totalAppointments: number;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  synced: number;
  skipped: number;
  failed: number;
  pending: number;
  details?: {
    synced: string[];
    skipped: string[];
    failed: string[];
    pending: string[];
  };
}

export interface PendingAppointment {
  appointment: Appointment;
  reason: "patient_not_found" | "schedule_creation_failed";
  timestamp: string;
  retryCount: number;
  patientExternalId: string;
}

export interface ScheduleCreateRequest {
  startTime: string;
  endTime: string;
  scheduleDate: string;
  appointmentType: "ONLINE";
  owner: {
    userId: string;
    userType: "STAFF";
  };
  participantInfo: Array<{
    userId: string;
    userType: "STAFF" | "USER";
    organizationID: string;
  }>;
  organizationID: string;
  externalAppointmentId: string;
  meta?: {
    externalAppointmentId: string;
    consultationType?: string;
    visitId?: number;
  };
}

export interface ScheduleStatusUpdateRequest {
  scheduleId: string;
  status: "ACCEPTED" | "CANCELLED" | "COMPLETED";
  organizationID: string;
}

export interface FetchSchedulesRequest {
  fromDate: number; // timestamp
  toDate: number;   // timestamp
  organizationID: string;
}
```

---

## Implementation Checklist

### Phase 1: Schedule Service Client
- [ ] Create `src/clients/schedule-service.client.ts`
- [ ] Implement `fetchSchedules()` method
- [ ] Implement `createSchedule()` method
- [ ] Implement `updateScheduleStatus()` method
- [ ] Add retry logic with exponential backoff
- [ ] Add error handling
- [ ] Add unit tests

### Phase 2: Appointment Mapper
- [ ] Create `src/mappers/appointment.mapper.ts`
- [ ] Implement `mapAppointmentToSchedule()` method
- [ ] Handle all field mappings
- [ ] Add validation for required fields
- [ ] Add unit tests

### Phase 3: Appointment Sync Service
- [ ] Create `src/services/appointment-sync.service.ts`
- [ ] Implement `syncAppointments()` method
- [ ] Implement `validateDoctor()` method
- [ ] Implement `validatePatient()` method
- [ ] Implement `checkDuplicateSchedule()` method
- [ ] Implement `createSchedule()` method
- [ ] Implement `updateScheduleStatus()` method
- [ ] Implement `processAppointments()` method
- [ ] Add error handling
- [ ] Add logging
- [ ] Add unit tests

### Phase 4: Idempotency and Retry
- [ ] Implement idempotency check using `externalAppointmentId`
- [ ] Implement retry mechanism with exponential backoff
- [ ] Add retry configuration
- [ ] Add retry logging
- [ ] Add unit tests

### Phase 5: Error Handling
- [ ] Implement error handling for all scenarios
- [ ] Add error logging
- [ ] Add error response formatting
- [ ] Add unit tests

### Phase 6: Pending Appointment Reprocessing
- [ ] Implement pending appointment storage
- [ ] Implement reprocessing logic
- [ ] Integrate with patient creation event
- [ ] Add retry mechanism for pending appointments
- [ ] Add unit tests

### Phase 7: API Endpoint
- [ ] Create `src/handlers/http/appointment-sync.ts`
- [ ] Create `src/controllers/appointment-sync.controller.ts`
- [ ] Add route in serverless.yml
- [ ] Add validation
- [ ] Add authorization
- [ ] Add integration tests

### Phase 8: Types and Interfaces
- [ ] Create `src/types/appointment-sync.types.ts`
- [ ] Define all required types
- [ ] Export types

### Phase 9: Testing
- [ ] Unit tests for all services
- [ ] Integration tests for API endpoints
- [ ] End-to-end tests for full flow
- [ ] Test error scenarios
- [ ] Test retry scenarios
- [ ] Test idempotency
- [ ] Test pending appointment reprocessing

### Phase 10: Documentation
- [ ] Update API documentation
- [ ] Add code comments
- [ ] Update README
- [ ] Add sequence diagrams

---

## Configuration

**Environment Variables:**

```typescript
// Schedule Service
SCHEDULE_SERVICE_API_URL=https://api.example.com
SCHEDULE_SERVICE_API_TIMEOUT_MS=10000

// Retry Configuration
APPOINTMENT_SYNC_MAX_RETRIES=3
APPOINTMENT_SYNC_RETRY_DELAY_MS=1000
APPOINTMENT_SYNC_MAX_RETRY_DELAY_MS=10000

// Concurrency
APPOINTMENT_SYNC_CONCURRENCY_LIMIT=5
```

---

## Sequence Diagram

```
External System        Integration Service        Schedule Service        User Service
       |                        |                        |                      |
       |----Fetch Appointments->|                        |                      |
       |<----Appointment List---|                        |                      |
       |                        |                        |                      |
       |                        |----Validate Doctor---->|                      |
       |                        |<---Doctor Details------|                      |
       |                        |                        |                      |
       |                        |----Validate Patient--->|                      |
       |                        |<---Patient Exists------|                      |
       |                        |                        |                      |
       |                        |----Check Duplicate---->|                      |
       |                        |   (fetch schedules)    |                      |
       |                        |<---Schedule Exists-----|                      |
       |                        |                        |                      |
       |                        |----Create Schedule---->|                      |
       |                        |   (create schedule)    |                      |
       |                        |<---Schedule Created----|                      |
       |                        |                        |                      |
       |                        |----Update Status------>|                      |
       |                        |   (update status)      |                      |
       |                        |<---Status Updated------|                      |
       |                        |                        |                      |
       |                        |----Process Pending---->|                      |
       |                        |   (if patient missing) |                      |
       |                        |                        |                      |
```

---

## Key Design Decisions

1. **Idempotency:** Use `externalAppointmentId` stored in schedule meta to prevent duplicates
2. **Retry Strategy:** Exponential backoff with max 3 attempts for transient failures
3. **Error Handling:** Continue processing other appointments even if one fails
4. **Pending Appointments:** Store in memory/queue and reprocess after patient creation
5. **Concurrency:** Process appointments in parallel with configurable limit
6. **Logging:** Comprehensive logging for debugging and monitoring

---

## Next Steps

1. Review and approve this plan
2. Implement Phase 1 (Schedule Service Client)
3. Implement Phase 2 (Appointment Mapper)
4. Implement Phase 3 (Appointment Sync Service)
5. Implement remaining phases
6. Add comprehensive tests
7. Deploy to dev environment
8. Test with real external system
9. Deploy to staging/production

---

## Notes

- All fields from external API are mandatory (as per requirements)
- Empty appointment array handling is already implemented
- Doctor validation logic is already implemented
- Patient validation needs to be added
- Schedule APIs need to be integrated
- Pending appointment reprocessing needs to be implemented

---

## HMS Batch Sync (New API + HTTP Endpoint)

This section documents the new HMS multi-doctor, date-range API and the corresponding batch sync entrypoints in this service.

### HMS API: Appointments for Doctors (Date Range)

**Endpoint (HMS side):**

```http
POST /api/teleconsultation/appointments-for-doctors
Content-Type: application/json

{
  "doctor_ids": [4, 7, 12],
  "start_date": "2026-03-09",
  "end_date": "2026-03-10"
}
```

**Client & Adapter:**

- `src/clients/tru-tech.clients.ts`
  - `getAppointmentsForDoctorsInRange(doctorIds, startDate, endDate, correlationId)`
- `src/adapters/trutech.adapter.ts.ts`
  - `mapAppointments()` → maps HMS response into internal `Appointment[]`.

**Provider Service:**

- `src/services/hms-appointments-provider.service.ts`
  - `getAppointmentsForDoctorsInRange(doctorIds, startDate, endDate, correlationId)`
    - Wraps the TruTech client + adapter.

### Batch Sync Orchestration

**Registered Doctors:**

- `src/services/registered-doctor.service.ts`
  - `getRegisteredDoctorIds(correlationId)`: returns HMS doctor IDs to include in batch sync.
  - Currently configuration-driven via env:
    - `REGISTERED_HMS_DOCTOR_IDS=4,7,12`

**Batch Service:**

- `src/services/hms-appointment-batch-sync.service.ts`
  - `syncAllRegisteredDoctors(startDate, endDate, correlationId)`:
    - Reads HMS doctor IDs from `RegisteredDoctorService`.
    - Chunks them (e.g. 50 per request).
    - Calls `HmsAppointmentsProvider.getAppointmentsForDoctorsInRange(...)`.
    - Groups appointments by `appointment.doctor.id`.
    - For each doctor, calls:
      - `AppointmentSyncService.syncAppointmentsForDoctorWithProvidedAppointments(doctorId, appointments, correlationId)`.
    - Returns a summary:
      - `startDate`, `endDate`, `doctorCount`, `appointmentsFetched`, `doctorsProcessed`.

**Scheduler / Lambda Handler:**

- `src/handlers/events/sync-hms-appointments.ts`
  - Entry point for both EventBridge Scheduler and HTTP batch endpoint.
  - Computes date range:
    - `startDate` = today (`YYYY-MM-DD`).
    - `endDate` = `today + SYNC_LOOKAHEAD_DAYS` (env; default `1`).
  - Calls `HmsAppointmentBatchSyncService.syncAllRegisteredDoctors(...)`.

### HTTP Batch Sync Endpoint

**Serverless Configuration:**

```yaml
functions:
  syncHmsAppointments:
    handler: src/handlers/events/sync-hms-appointments.handler
    description: Periodic HMS appointment synchronization from TruTech into schedule service
    timeout: 900
    memorySize: 512
    events:
      - http:
          path: /appointments/sync/hms
          method: post
          cors:
            origin: '*'
            headers:
              - Content-Type
              - Authorization
              - X-Correlation-Id
              - X-Request-Id
            allowCredentials: false
          authorizer:
            name: authorizer
            type: token
            identitySource: method.request.header.Authorization
            arn: arn:aws:lambda:${self:provider.region}:${aws:accountId}:function:authorizer-service-${self:provider.stage}-authorizer
```

**Usage (local via serverless-offline):**

```http
POST http://localhost:3000/appointments/sync/hms
Authorization: Bearer <JWT>
Content-Type: application/json

{}
```

**Behavior:**

- No request body fields are required; the handler:
  - Derives date range from `SYNC_LOOKAHEAD_DAYS`.
  - Reads HMS doctor IDs from `REGISTERED_HMS_DOCTOR_IDS`.
- For each doctor, it runs the same idempotent sync logic as `POST /appointments/sync?doctorId=<id>`.

### EventBridge Scheduler

**Configuration (in `serverless.yml`):**

```yaml
provider:
  environment:
    SYNC_LOOKAHEAD_DAYS: ${env:SYNC_LOOKAHEAD_DAYS, '1'}

resources:
  Resources:
    SyncHmsAppointmentsScheduleRole:
      Type: AWS::IAM::Role
      Properties:
        AssumeRolePolicyDocument:
          Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Principal:
                Service: scheduler.amazonaws.com
              Action: sts:AssumeRole
        Policies:
          - PolicyName: InvokeSyncHmsAppointmentsLambda
            PolicyDocument:
              Version: '2012-10-17'
              Statement:
                - Effect: Allow
                  Action:
                    - lambda:InvokeFunction
                  Resource:
                    - arn:aws:lambda:${self:provider.region}:${aws:accountId}:function:${self:service}-${self:provider.stage}-syncHmsAppointments

    SyncHmsAppointmentsSchedule:
      Type: AWS::Scheduler::Schedule
      Properties:
        ScheduleExpression: ${env:HMS_SYNC_SCHEDULE_EXPRESSION, 'rate(30 minutes)'}
        FlexibleTimeWindow:
          Mode: FLEXIBLE
          MaximumWindowInMinutes: 5
        State: ENABLED
        Target:
          Arn: arn:aws:lambda:${self:provider.region}:${aws:accountId}:function:${self:service}-${self:provider.stage}-syncHmsAppointments
          RoleArn: !GetAtt SyncHmsAppointmentsScheduleRole.Arn
          Input: |
            {
              "source": "hms-appointments-scheduler"
            }
          RetryPolicy:
            MaximumEventAgeInSeconds: 3600
            MaximumRetryAttempts: 3
```

The scheduler and HTTP batch endpoint share the same handler and appointment sync pipeline, ensuring consistent behavior, idempotency, and retries.
