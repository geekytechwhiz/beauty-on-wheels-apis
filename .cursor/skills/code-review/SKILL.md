---
name: code-review
description: Reviews pull requests and code changes for the api-hub healthcare serverless platform. Enforces clean architecture, API standards, security, healthcare domain rules, and AWS serverless patterns from project conventions. Use when reviewing PRs, examining diffs, asking for a code review, or before merge.
---

# Code Review — api-hub

## When to apply

Use this skill when the user asks for a review, before merge, or when examining PR/diff changes in this repo.

## Standards source

Apply rules from [.cursor/rules.md](../../rules.md) and the [PR checklist](../../../docs/pr-template.md). Do not invent new conventions unless the user requests them.

## Review workflow

1. **Scope** — Identify changed modules under `apps/` or `services/`. Note feature vs fix vs refactor.
2. **Architecture** — Verify layer boundaries: `Controller → Service → Domain → Repository → DB`.
3. **Domain** — For patient/clinical/care-plan/vitals changes, check healthcare rules (audit, versioning, timestamps).
4. **Security** — Secrets, validation, PII in logs, IAM (no static credentials).
5. **API & events** — Standard response shape, HTTP codes, `/v1/` versioning, immutable versioned events.
6. **Tests & ops** — Unit tests for services; structured logs with correlation IDs; no sensitive data logged.

## Must-block (request changes)

- Business logic in controllers
- Direct DB access outside repository layer
- Missing input validation or error handling
- Hardcoded secrets, configs, or credentials
- Sensitive data (PII/PHI) in logs
- Cross-module imports without an explicit interface
- Unversioned breaking API or event schema changes
- Patient/clinical writes without required metadata (`patientId`, `timestamp`, `source` where applicable)
- Care plan overwrites instead of versioning
- Missing audit trail for prescriptions, care plan changes, or clinical decisions

## Should-fix (suggest before merge)

- Logic that belongs in service vs repository
- Non-standard API response format
- Missing pagination on list endpoints
- N+1 queries or blocking calls in Lambda handlers
- Weak naming or missing types in `types.ts`
- Missing unit tests for new/changed business logic
- Monolithic Lambda doing multiple unrelated jobs

## Nice-to-have

- Refactors for readability
- Additional edge-case tests
- README or OpenAPI updates for new APIs

## Feedback format

Structure the review as:

```markdown
## Summary
[1–2 sentences: what changed and overall risk]

## Critical
- [Must fix before merge]

## Suggestions
- [Should improve]

## Optional
- [Nice to have]

## Checklist
- [ ] Architecture layers respected
- [ ] API / event standards
- [ ] Security & healthcare rules
- [ ] Tests & logging
```

Use severity labels in prose: **Critical**, **Suggestion**, **Optional**.

## Module-specific focus

| Area | Extra checks |
|------|----------------|
| `apps/*-service` | `handler` → `controller` → `service` → `repository`; `validator.ts` on inputs |
| Event publishers | Immutable, versioned payloads; no breaking `eventType` changes without version bump |
| FHIR / generated code | Human review required; verify mapping and no secrets in generated output |
| Shared code | No service-specific business logic leaking into `/shared` |

## Output rules

- Cite specific files and lines when flagging issues.
- Prefer concrete fixes over vague advice.
- If change is small and clean, say so briefly — do not pad the review.
- Do not request changes outside the diff scope unless they introduce a clear regression or security risk.
