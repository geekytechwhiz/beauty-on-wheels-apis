Perform a full architectural review of the HMS appointment sync implementation in the sso-integration service and refactor it to follow an asynchronous queue-based architecture suitable for production scale.

Current Situation

The current flow processes appointment synchronization synchronously inside the HTTP endpoint or scheduler Lambda.

The flow currently looks like:

HTTP endpoint or scheduler
→ AppointmentSyncController
→ AppointmentSyncService.syncAppointments()
→ fetch HMS appointments
→ process appointments (loops with manual concurrency)
→ validate/create doctor and patient
→ check duplicate schedules
→ create schedules
→ update schedule status
→ return summary

This synchronous approach causes API Gateway timeouts and does not scale for 50–500 appointments.

Goal

Refactor the system to follow this architecture:

Trigger (HTTP or scheduler)
→ publish job to SQS
→ return immediately

Worker Lambda (SQS triggered)
→ fetch HMS appointments
→ process appointments
→ create users if needed
→ create schedules
→ handle retries
→ update counters

Steps to Implement

1. Introduce an AppointmentSyncJob payload type.

Example:

{
  tenantId: string,
  startDate: string,
  endDate: string,
  doctorId?: number,
  correlationId: string
}

2. Create a new service called AppointmentSyncJobPublisherService that publishes jobs to an SQS queue using SendMessageCommand.

Queue URL should come from environment variable APPOINTMENT_SYNC_QUEUE_URL.

3. Modify existing entry points:

handlers/http/appointments.ts  
handlers/events/sync-hms-appointments.ts

Replace direct calls to:

appointmentSyncService.syncAppointments(context)

with logic that:

• builds an AppointmentSyncJob
• publishes it to SQS
• returns immediately with a success response

Example response:

{
  message: "Appointment sync job queued",
  correlationId
}

4. Create a new worker Lambda handler:

src/handlers/sqs/appointment-sync-worker.ts

The worker should:

• receive SQS messages
• parse AppointmentSyncJob
• build RequestContext using buildSchedulerContext()
• call a new method syncAppointmentsForJob(job, context)

5. Move the heavy logic into AppointmentSyncService.syncAppointmentsForJob().

This method should:

• fetch appointments from HMS
• normalize appointments
• call existing processing logic
• keep retryWithBackoff logic
• maintain counters

Do NOT rewrite business logic unless necessary.

6. Ensure SQS partial batch failure handling:

Return batchItemFailures for failed messages so SQS can retry.

7. Ensure DLQ compatibility.

Worker Lambda should allow failed messages to retry and eventually land in DLQ.

8. Remove synchronous appointment processing from HTTP handlers.

The HTTP request must complete immediately after publishing the SQS job.

Performance Improvement (Important)

Currently duplicate schedule detection calls ScheduleService.fetchSchedules() per appointment.

This creates excessive API calls.

Implement the following optimization:

Instead of calling fetchSchedules() for each appointment:

1. Fetch schedules once per doctor per date range.
2. Store them in an in-memory map:

existingSchedulesByDoctorAndTime

3. When processing appointments:
   - check duplicates using the in-memory schedule list
   - only call schedule service when creating a new schedule.

This reduces schedule fetch calls by approximately 70%.

Example approach:

• Fetch schedules for doctor once
• Build lookup map using externalAppointmentId and time range
• Validate duplicates locally during processing loop

Do not change existing schedule creation APIs.

Ensure compatibility with existing fields:

meta.externalAppointmentId
participants

Expected Output

1. Show the new architecture after refactor.
2. Show code changes for:
   - HTTP handlers
   - scheduler handler
   - new SQS publisher
   - new worker Lambda
   - updated AppointmentSyncService
3. Ensure existing retry logic and counters remain intact.
4. Ensure the system can scale safely for 50–500 appointments without API Gateway timeout.