---
name: event-driven-design
description: Designs and reviews event-driven microservices for AWS Serverless platforms using EventBridge, DynamoDB Streams, SQS, SNS, Lambda, and idempotent event processing. Use when creating publishers, consumers, event schemas, integration patterns, retries, DLQs, or event-driven workflows.
---

# Event Driven Design — Healthcare Platform

## When to apply

- Creating new domain events
- Creating EventBridge integrations
- Designing DynamoDB Stream consumers
- Creating SQS consumers
- Designing asynchronous workflows
- Reviewing event contracts
- Implementing retries and DLQ handling
- Designing service-to-service communication

---

# Platform Standards

## Event First

Prefer asynchronous communication when:

- Immediate response is not required
- Cross-service workflows exist
- Processing may take time
- Multiple consumers need the same information

Prefer:

Patient Service
→ EventBridge
→ Notification Service

instead of:

Patient Service
→ Direct HTTP
→ Notification Service

---

## Service Ownership

Every service owns:

- Its DynamoDB tables
- Its domain models
- Its business rules
- Its events

Never read another service's database.

Use:

- Events
- APIs

for cross-service communication.

---

# Event Naming

Use past-tense business events.

Good:

```text
PatientCreated
PatientUpdated
PrescriptionIssued
AppointmentScheduled
VitalsRecorded
CarePlanAssigned
RewardPointsEarned
```

Bad:

```text
CreatePatient
UpdatePatient
ProcessVitals
```

Events describe facts that happened.

---

# Event Structure

All events must include:

```typescript
{
  eventId: string;
  eventType: string;
  eventVersion: string;
  timestamp: string;
  organizationId: string;
  sourceService: string;
  correlationId: string;
  payload: {};
}
```

---

## Example

```typescript
{
  eventId: "evt-123",
  eventType: "PatientCreated",
  eventVersion: "1.0",
  timestamp: "2026-06-01T12:00:00Z",
  organizationId: "org-123",
  sourceService: "patient-service",
  correlationId: "req-456",
  payload: {
    patientId: "pat-001"
  }
}
```

---

# Event Versioning

Always version events.

```typescript
eventVersion: "1.0"
```

When adding fields:

```typescript
1.0
→
1.1
```

When making breaking changes:

```typescript
1.x
→
2.0
```

Never break existing consumers.

Support old versions during migration.

---

# EventBridge Standards

Use EventBridge for:

- Domain events
- Cross-service integrations
- Fan-out patterns

Examples:

```text
PatientCreated
AppointmentCompleted
VitalsRecorded
```

Avoid EventBridge for:

```text
Large payload transfer
High-throughput queues
Work queues
```

Use SQS instead.

---

# SQS Standards

Use SQS for:

- Work queues
- Background processing
- High-volume tasks
- Retry-heavy workloads

Examples:

```text
SendEmail
GenerateReport
ExportPatientData
SyncDeviceData
```

---

# SNS Standards

Use SNS when:

- External integrations exist
- SMS notifications
- Email notifications
- Multi-channel notifications

Do not use SNS as a workflow engine.

---

# DynamoDB Streams

Use Streams when reacting to:

```text
INSERT
MODIFY
REMOVE
```

Examples:

```text
Patient Created
Prescription Updated
Vital Recorded
```

Stream handlers should:

- Be lightweight
- Delegate to services
- Remain idempotent

Never place business logic directly in handlers.

---

# Idempotency

Every consumer must be idempotent.

Events may be delivered:

```text
Once
Twice
Many times
```

Consumers must handle duplicates safely.

---

## Preferred Pattern

Store processed events.

```typescript
PK = EVENT#<eventId>
```

Condition:

```typescript
attribute_not_exists(pk)
```

---

# Outbox Pattern

For critical workflows:

```text
PatientCreated
PrescriptionIssued
PaymentCompleted
```

Use:

```text
Transaction
+
Outbox Record
+
Publisher
```

instead of:

```text
Write Data
Publish Event
```

Publishing must happen after persistence.

---

# Retry Strategy

Consumers must assume transient failures.

Use:

```text
Retry
+
DLQ
```

for all asynchronous consumers.

---

## Lambda + SQS

Configure:

```yaml
maximumRetryAttempts: 3
```

DLQ required.

---

## Lambda + Streams

Enable:

```yaml
functionResponseType:
  - ReportBatchItemFailures
```

---

# Dead Letter Queues

All production consumers must have DLQs.

Required for:

- SQS consumers
- EventBridge consumers
- Stream consumers

Monitor:

```text
ApproximateNumberOfMessagesVisible
```

---

# Correlation IDs

Propagate correlation IDs.

Incoming Request:

```text
requestId
```

↓

Event

↓

Consumer

↓

Child Events

Maintain traceability across services.

---

# Event Payload Rules

Include only required information.

Good:

```typescript
{
  patientId,
  organizationId
}
```

Bad:

```typescript
{
  patientFullProfile,
  documents,
  images,
  notes
}
```

Consumers should fetch additional data from APIs if needed.

---

# Healthcare Platform Rules

Never include PHI in:

- EventBridge payloads
- SNS messages
- Logs
- Queue metadata

Allowed:

```text
patientId
organizationId
```

Not Allowed:

```text
email
phone
diagnosis
prescription details
medical notes
```

unless explicitly approved and encrypted.

---

# Observability

Every event flow should log:

```typescript
{
  eventId,
  eventType,
  sourceService,
  correlationId
}
```

Do not log payload contents containing PHI.

---

# Anti Patterns

## Direct Database Access

Bad:

```text
Notification Service
→ Reads Patient Service Table
```

Good:

```text
PatientCreated Event
→ Notification Service
```

---

## Event Chains

Bad:

```text
A → B → C → D → E → F
```

Prefer:

```text
A → EventBridge
```

with independent consumers.

---

## Synchronous Workflows

Bad:

```text
Patient Service
→ Notification Service
→ Loyalty Service
→ Analytics Service
```

Good:

```text
PatientCreated

→ Notification Consumer
→ Loyalty Consumer
→ Analytics Consumer
```

---

## Large Payloads

Never publish:

```text
PDF
Images
Medical Files
Reports
```

Store in S3 and publish references.

---

# Review Checklist

Generated code should verify:

- [ ] Event name is past tense
- [ ] Event version exists
- [ ] Correlation ID exists
- [ ] Consumer is idempotent
- [ ] Retry strategy defined
- [ ] DLQ configured
- [ ] No PHI in payload
- [ ] EventBridge vs SQS choice justified
- [ ] No direct database access across services
- [ ] Outbox pattern used for critical workflows
- [ ] Logs contain event metadata only