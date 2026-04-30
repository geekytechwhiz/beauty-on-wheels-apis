Objective: Implement retry logic in core/retry/

Requirements:

- Support:
  - maxAttempts
  - exponential backoff
  - fixed delay

- API:
retry(fn, options)

- Handle:
  - async errors
  - retryable vs non-retryable errors (basic classification)

- Use existing logger if available

- No side effects outside retry

Tests:
- success after retry
- failure after max attempts

DO NOT:
- integrate with consumer yet