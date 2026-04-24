Scan entire repo and validate alignment with ERS architecture.

Check:
- All handlers use middleware engine
- No local event envelope duplication
- No middleware handling idempotency
- Logger always uses AsyncLocalStorage context
- No direct console logging

Output:
- list of violations
- suggested fixes per file