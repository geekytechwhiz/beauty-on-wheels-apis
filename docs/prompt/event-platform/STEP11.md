Objective: Add tracing/logging hooks in core/tracing/

Requirements:

- Inject correlationId into flow
- Use existing logger

- Add hooks:
  - event received
  - event processed
  - event failed

DO NOT:
- introduce new observability tools
- reuse existing logging infra