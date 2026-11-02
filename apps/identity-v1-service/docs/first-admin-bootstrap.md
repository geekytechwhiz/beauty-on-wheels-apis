# First-admin bootstrap (operator CLI)

Locally executed Identity operator utility. There is **no** public bootstrap HTTP endpoint.

`ADMIN` is an application role mapping (`USER#{userId}` / `ROLE#ADMIN`), not an OTP `userType`. Public `/otp/send` still accepts only `CUSTOMER` | `VENDOR`. The CLI creates or reuses the identity through the normal verified OTP flow, then assigns `ADMIN` separately.

## Invocation

Dry-run (default) — preflight + OTP confirm + validation; does **not** write the ADMIN mapping:

```bash
export AWS_REGION=us-east-1
# Prefer SSO / assumed-role. Do not pass static keys to the process.

# Prefer the compatibility launcher (sets @api-hub/source for workspace packages):
#   node scripts/bootstrap-first-admin.mjs --stage dev ...
NODE_OPTIONS='--conditions=@api-hub/source' pnpm exec tsx \
  apps/identity-v1-service/src/scripts/bootstrap-first-admin/cli.ts \
  --stage dev \
  --table identity-table-dev \
  --api-base-url "https://<identity-api-base>" \
  --destination "admin@example.com" \
  --approved-by "alice@example.com" \
  --executed-by "bob@example.com" \
  --change-ticket "CHG-001" \
  --expected-account-id "123456789012"
```

Apply (writes ADMIN mapping + bootstrap marker + audit in one DynamoDB transaction):

```bash
NODE_OPTIONS='--conditions=@api-hub/source' pnpm exec tsx \
  apps/identity-v1-service/src/scripts/bootstrap-first-admin/cli.ts \
  --stage dev \
  --table identity-table-dev \
  --api-base-url "https://<identity-api-base>" \
  --destination "admin@example.com" \
  --approved-by "alice@example.com" \
  --executed-by "bob@example.com" \
  --change-ticket "CHG-001" \
  --expected-account-id "123456789012" \
  --apply \
  --confirm "BOOTSTRAP FIRST ADMIN"
```

Production is refused unless `--confirm-production` is set (plus change ticket and distinct approver/executor):

```bash
# ...same flags...
  --stage prod \
  --table identity-table-prod \
  --confirm-production \
  --apply \
  --confirm "BOOTSTRAP FIRST ADMIN"
```

Resume a recoverable run:

```bash
# ...same flags...
  --resume-run-id "<runId-from-journal>" \
  --apply \
  --confirm "BOOTSTRAP FIRST ADMIN"
```

Optional: `--user-type CUSTOMER|VENDOR` (default `CUSTOMER`), `--allow-unverified` (non-prod only; for fixed-OTP stages), `--expected-region us-east-1`.

After a successful apply, **sign in again** so Cognito Pre Token Generation V2_0 issues a fresh access token that includes `ADMIN` in `roles`.

## What the one command does

1. Preflight: stage, AWS account, region, Identity API base URL, Identity table (`ACTIVE`).
2. OTP send/verify against the deployed Identity API; OTP is entered via hidden terminal input. OTP and access/refresh tokens are never logged, printed, or journaled.
3. Resolves application `userId` from the Identity destination lookup (`EMAIL#` / `PHONE#`), never from Cognito `sub`.
4. Checks active status and stage verification policy.
5. Confirms `ROLE#ADMIN` / `METADATA` exists and that no first-admin marker / ADMIN mapping already exists.
6. Atomically writes ADMIN mapping + `SYSTEM#FIRST_ADMIN_BOOTSTRAP` marker + audit log (same storage contract as `IdentityRepository.ensureUserRoleMapping`). Does **not** change META `roleId`.
7. Persists a durable operation journal (`SYSTEM#FIRST_ADMIN_BOOTSTRAP_JOURNAL` / `RUN#{runId}`) and verifies the mapping after commit.

## Least-privilege AWS permissions

Operator role/session needs approximately:

| Action | Resource |
|---|---|
| `sts:GetCallerIdentity` | `*` |
| `dynamodb:DescribeTable` | Identity table |
| `dynamodb:GetItem` | Identity table |
| `dynamodb:PutItem` | Identity table |
| `dynamodb:DeleteItem` | Identity table (lock release / safe compensation only) |
| `dynamodb:Query` | Identity table |
| `dynamodb:Scan` | Identity table (ADMIN mapping existence check; no role-to-user GSI) |
| `dynamodb:ConditionCheckItem` / `dynamodb:TransactWriteItems` | Identity table |

Network access to the Identity API base URL is also required (OTP send/verify). Cognito admin APIs are **not** required for the happy path; OTP goes through Identity. Do not grant broad `cognito-idp:AdminDeleteUser` to the bootstrap role.

## Saga, rollback limitations, recovery

Cognito and DynamoDB are not one transaction. The CLI records ownership flags **before** OTP mutates state:

- Compensates Identity deletes **only** when the journal proves this run created the account and no pre-existing account was reused.
- Never speculative-deletes Cognito users when ownership is unknown.
- Downstream DynamoDB Streams → `IdentityRegistered` → User Service provisioning is **not** reversed by this CLI. If PROFILE shows `PENDING`/`LINKED` provisioning, the run stops in `needsManualRecovery`.

### Manual recovery checklist

1. Read journal: `PK=SYSTEM#FIRST_ADMIN_BOOTSTRAP_JOURNAL`, `SK=RUN#<runId>`.
2. Inspect marker: `PK=SYSTEM#FIRST_ADMIN_BOOTSTRAP`, `SK=META`.
3. Inspect mapping: `PK=USER#<userId>`, `SK=ROLE#ADMIN`.
4. If commit never landed: fix the cause and `--resume-run-id`.
5. If marker/mapping exist but verify failed: do not re-bootstrap; repair in place and have the user sign in again.
6. If a new Identity was created but ADMIN was not committed, and streams provisioned User Service: coordinate User Service cleanup separately; do not delete Cognito/Identity unless ownership is proven and product owners approve.

## Tests

```bash
pnpm exec nx test identity-v1-service --testPathPattern=bootstrap-first-admin
```
