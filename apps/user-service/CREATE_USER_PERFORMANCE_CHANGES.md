# Create User Performance Changes

This document captures the performance-focused updates applied to the current release code in `api-hub/apps/user-service`.

## Scope Covered

- `src/handlers/createUser.ts`
- `src/handlers/create-user.ts`
- `src/services/user.service.ts`
- `src/services/create_user.ts`
- `src/models/user/create-user-model.ts`

Both create-user API variants are now aligned with the same latency strategy.

## Key Improvements

1. Reduced duplicate synchronous work in handlers
- Removed duplicate role-permission lookups.
- Removed synchronous ADMIN feature bootstrap from request path (`getOrgFeatures` + `saveRoles`) to avoid extra network/DB delay during onboarding.

2. Added step timing logs for latency visibility
- Added request-step timing logs in both handlers:
  - org validation timing
  - role lookup timing
  - core create timing
  - role assignment timing
  - total handler timing
- Added service-step timing logs:
  - org validation/fetch
  - Cognito existence checks
  - Cognito create
  - DB create user
  - DB org assignment
  - post-create async tasks

3. Removed double org validation on hot path
- Handlers now set an internal marker to skip re-validation in service layer for the same request.
- Service still performs minimal org fetch required for notification/template context.

4. Improved Cognito check latency
- Changed Cognito existence checks from sequential to parallel (`email` and `phone`) in `user.service.ts`.

5. Moved non-critical work off synchronous response path
- Post-create tasks are now async by default:
  - friend/family linking
  - doctor assignment
  - notification publishing
- Role assignment after create is async by default in both handlers.

6. Restored create-user domain event publish usage
- Wired `src/events/UserCreated.ts` back into both create-user handlers.
- `UserCreated.v1` is now published after core create success for:
  - `src/handlers/createUser.ts`
  - `src/handlers/create-user.ts`
- Publish failures are logged as warnings and do not fail the API response.

## Backward-Compatible Safety Switches

Set these environment variables to force old synchronous behavior if needed:

- `CREATE_USER_SYNC_ROLE_ASSIGNMENT=true`
  - Waits for role assignment before returning API response.

- `CREATE_USER_SYNC_POST_CREATE_TASKS=true`
  - Waits for friend/family linking, doctor assignment, and notification flow before returning from service.

By default (unset/false), async performance mode is active.

## Data/Behavior Notes

- Core create path remains synchronous and safe:
  - org validation
  - Cognito create
  - user DB create
  - org-user mapping DB write
- Non-critical tasks are best-effort async and failures are logged without blocking create-user response.
- Internal skip marker is sanitized before persistence so it is not stored in DB records.

## Validation

- Lint checks were run on all updated files.
- No linter errors found after changes.

## How To Read Timings

Use these log events to identify where latency is spent for each request (group by `correlationId`).

### Handler timing events

- `createUser_org_validation_timing` / `create_user_org_validation_timing`
- `createUser_role_lookup_timing` / `create_user_role_lookup_timing`
- `createUser_core_create_timing` / `create_user_core_create_timing`
- `createUser_assignUserRole_success|failed` / `create_user_assignUserRole_success|failed`
- `createUser_handler_total_timing` / `create_user_handler_total_timing`

Interpretation:
- If `handler_total` is high and `core_create` is low, look at role assignment mode/config.
- If `core_create` is high, inspect service timing events below.

### Service timing events

- `service_createUser_step_timing`
  - `step=organization_validation`
  - `step=organization_fetch_minimal_for_notifications`
  - `step=cognito_existence_checks`
  - `step=cognito_create_user`
  - `step=cognito_total`
  - `step=db_create_user`
  - `step=db_assign_user_to_org`
  - `step=post_create_friend_family`
  - `step=post_create_doctor_assignment`
  - `step=post_create_total`

- `create_user_step_timing` (for `create-user.ts` + `create_user.ts` flow)
  - `step=organization_validation`
  - `step=organization_fetch_minimal`
  - `step=cognito_create_user`
  - `step=db_create_user`
  - `step=db_assign_user_to_org`
  - `step=post_create_friend_family`
  - `step=post_create_doctor_assignment`
  - `step=post_create_total`

Interpretation:
- High `cognito_existence_checks` or `cognito_total` -> Cognito latency bottleneck.
- High `db_create_user` or `db_assign_user_to_org` -> DynamoDB write bottleneck.
- High `post_create_*` only affects response when sync switches are enabled.

### Quick check for SLA

For base-flow SLA (`<=2-3s`), monitor:
- `createUser_handler_total_timing.durationMs`
- `create_user_handler_total_timing.durationMs`

Then correlate with:
- `createUser_core_create_timing.durationMs` / `create_user_core_create_timing.durationMs`
- service step timing `durationMs` breakdown by step.

### Config impact on timings

- `CREATE_USER_SYNC_ROLE_ASSIGNMENT=true`
  - Increases handler total by waiting for role assignment.
- `CREATE_USER_SYNC_POST_CREATE_TASKS=true`
  - Increases service/core timing by waiting for friend/family, doctor, and notification tasks.
