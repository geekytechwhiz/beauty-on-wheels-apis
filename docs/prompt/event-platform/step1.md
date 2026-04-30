You are working inside an Nx monorepo with an already created library for event platform.

The library structure is:

core/
  event-envelope/
  idempotency/
  retry/
  dlq/
  schema/
  versioning/
  tracing/
  index.ts

adapters/
  sqs/
  eventbridge/
  sns/
  index.ts

sdk/
  publisher/
  consumer/
  config/
  index.ts

utils/
  logger/
  errors/
  constants/
  index.ts

---

### ⚠️ BEFORE making changes (MANDATORY)

1. Analyze the repository:
   - Identify existing utilities (UUID, hashing, logger, error handling)
   - Identify coding conventions (naming, folder patterns, exports)
   - Check if similar event/message structures already exist
2. Reuse existing utilities wherever possible
3. DO NOT introduce new libraries if equivalent utilities already exist
4. Follow the same coding style and patterns used in this repo

---

### 🎯 Objective (Step 1 Only)

Implement a **standard Event Envelope module** inside:

core/event-envelope/

This module must define:
- Event types
- Event envelope builder

This should be:
- Production-ready
- Fully reusable
- Independent of transport (NO SQS/EventBridge logic)
- Compatible with future modules (idempotency, retry, etc.)

---

### 📦 Implementation Requirements

#### 1. Create Event Types

Inside:
core/event-envelope/

Create a file (follow repo naming convention, e.g. event.types.ts or similar)

Define:

- EventMetadata
- BaseEvent<T>

Fields:

- eventId (string)
- eventType (string)
- version (string)
- timestamp (ISO string)
- source (string)
- correlationId (optional)
- idempotencyKey (string)

---

#### 2. Create Event Envelope Builder

Inside:
core/event-envelope/

Create a builder utility:

Responsibilities:

- Generate:
  - eventId (use existing UUID utility if available)
  - timestamp (ISO format)
- Generate idempotencyKey:
  - MUST use hashing (reuse existing hash utility if available)
  - MUST NOT use raw JSON.stringify directly unless no utility exists
- Accept input:
  - eventType
  - version
  - source
  - payload
  - optional correlationId

Return:
BaseEvent<T>

---

#### 3. Code Quality Rules

- Keep builder **pure and deterministic**
- No side effects
- No logging unless repo standard requires it
- Strong typing (use generics properly)
- Defensive checks for required fields

---

#### 4. Exports

- Export everything through:
  core/event-envelope/index.ts
- Also expose via:
  core/index.ts

Follow existing export pattern in repo

---

#### 5. Unit Tests (MANDATORY)

Add tests for:

- Event structure correctness
- Required fields presence
- idempotencyKey consistency (same payload → same key)
- Different payload → different key

Use existing testing setup (Jest or equivalent)

---

### ❌ DO NOT IMPLEMENT (STRICT)

- No adapters (SQS/EventBridge/SNS)
- No idempotency storage (DynamoDB)
- No retry logic
- No DLQ
- No schema validation
- No version compatibility logic

---

### 📌 Constraints

- Must not break existing code
- Must not modify unrelated modules
- Must integrate cleanly into current structure
- Prefer extending utils over duplicating logic

---

### 📤 Output Required

1. Show all new/modified files
2. Explain:
   - Why files are placed in those locations
   - Which existing utilities were reused
3. Confirm:
   - No breaking changes introduced
   - No duplication of existing utilities

   