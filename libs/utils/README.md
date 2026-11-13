# utils

This library was generated with [Nx](https://nx.dev).

## Domain entity IDs

New locally owned domain entities must use `EntityIdGenerator` from `@api-hub/utils` at
their creation boundary. IDs are strings in `PREFIX-YYYYMMDD-24_RANDOM_DIGITS` format.
Existing IDs remain supported on all read and relationship paths. Do not use this helper
for Cognito/provider IDs, event or correlation IDs, idempotency keys, OTPs, tokens, or
deterministic keys.

## Building

Run `nx build utils` to build the library.
