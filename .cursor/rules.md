Below is a **comprehensive, production-grade Cursor AI rules file** tailored for your setup:

* ✅ AWS Serverless
* ✅ Microservices
* ✅ Healthcare platform (compliance-aware)
* ✅ TypeScript + Node.js
* ✅ API-first + event-driven architecture

You can drop this into your repo as something like:

```
.cursor/rules.md
```

---

# 📘 Cursor AI Rules — Healthcare Platform

## 🧭 1. Core Principles

* Always follow **clean architecture**:

  ```
  Controller → Service → Domain → Repository → DB
  ```
* No business logic in controllers
* No direct DB access outside repository layer
* Prefer **composition over inheritance**
* Write **pure, testable functions**

---

## 🏗️ 2. Project Structure

Follow strict modular structure:

```
/apps,
  /service
    /<src>
      config
      controller
      handler
      service.ts
      repository.ts
      domain.ts
      validator.ts
      mapper.ts
      types.ts
      events.ts
```

Rules:

* Do NOT mix modules
* No cross-module imports without explicit interface
* Shared utilities go into `/shared`

---

## 🔌 3. API Design Standards

* Follow **OpenAPI (Swagger) first approach**
* Every API must:

  * Have request/response schema
  * Include validation
  * Return standard response format:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

* Error format:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input"
  }
}
```

* Use proper HTTP status codes
* APIs must be versioned: `/v1/`

---

## 🔐 4. Security Rules (CRITICAL)

* Never:

  * Hardcode secrets
  * Expose internal IDs
* Always:

  * Validate all inputs
  * Sanitize user data
  * Encrypt sensitive data (PII, health data)
  * Use IAM roles (no static credentials)
* Log security events:

  * Login
  * Data access
  * Updates to patient records

---

## 🏥 5. Healthcare Domain Rules

* Every patient-related data must include:

  * `patientId`
  * `timestamp`
  * `source`
* Care plans:

  * Must be versioned
  * Cannot be overwritten
* Vitals:

  * Must include unit + timestamp
* Audit trail required for:

  * Prescriptions
  * Care plan changes
  * Clinical decisions

---

## ⚙️ 6. Service Layer Rules

* Services must:

  * Contain business logic only
  * Be stateless
* No direct HTTP or DB logic
* Must handle:

  * Validation
  * Transformation
  * Orchestration

---

## 🗄️ 7. Repository Layer Rules

* Only layer allowed to access DB
* Must:

  * Abstract DB queries
  * Return domain models (not raw DB objects)
* No business logic allowed

---

## 🔄 8. Event-Driven Architecture

* Prefer async communication:

  * SNS / SQS / EventBridge
* Events must be:

  * Immutable
  * Versioned

Example:

```json
{
  "eventType": "PATIENT_VITALS_RECORDED",
  "version": "v1",
  "payload": {}
}
```

---

## 🧪 9. Testing Rules

* Every service must have:

  * Unit tests
* Critical flows:

  * Integration tests required
* Mock external dependencies
* Cover:

  * Edge cases
  * Failure scenarios

---

## 📝 10. Logging & Monitoring

* Use structured logs:

```json
{
  "level": "info",
  "service": "user-service",
  "message": "User created",
  "correlationId": "abc-123"
}
```

* Always log:

  * Errors
  * External API calls
* Do NOT log sensitive data

---

## 🚀 11. AWS Serverless Rules

* Use:

  * Lambda for compute
  * API Gateway for APIs
  * DynamoDB for storage
* Functions must:

  * Be small and single-purpose
* Avoid:

  * Large monolithic Lambdas

---

## 🔁 12. CI/CD & Deployment

* Every PR must:

  * Pass lint checks
  * Pass tests
* No direct commits to main
* Use environment configs:

  * dev / qa / prod

---

## 👀 13. PR Review Rules (AI should enforce)

AI must check:

* ❌ Business logic in controller
* ❌ Missing validation
* ❌ Missing error handling
* ❌ Direct DB access outside repository
* ❌ Hardcoded values

AI should suggest:

* Refactoring
* Better naming
* Test cases

---

## 📚 14. Documentation Rules

* Every module must have:

  * README
* APIs must be documented
* Complex logic must include comments

---

## ⚡ 15. Performance Rules

* Avoid:

  * N+1 queries
  * Blocking operations
* Use:

  * Pagination
  * Caching where applicable

---

## 🔄 16. Versioning Rules

* APIs must be versioned
* Events must be versioned
* Schema changes must be backward compatible

---

## 🧠 17. AI Behavior Rules (VERY IMPORTANT)

When generating code, AI must:

* Follow project structure strictly
* Use existing patterns in repo
* Prefer reusable components
* Avoid introducing new patterns unless necessary

---

## ❌ 18. Anti-Patterns (STRICTLY FORBIDDEN)

* Business logic in controllers
* Direct DB access in controllers/services
* Hardcoded configs
* Unvalidated inputs
* Skipping error handling
* Logging sensitive data

---

# 🔥 Optional Advanced Rules (Highly Recommended)

## 🧩 Rule Engine Compatibility

* Business rules must be externalizable (JSON/config)
* Avoid hardcoding logic

---

## 📊 Analytics & Tracking

* Track:

  * User actions
  * Health progress
* Use event-based tracking

---

## 🤖 AI/ML Readiness

* Store structured data
* Maintain clean datasets
* Log model decisions (if used)
 