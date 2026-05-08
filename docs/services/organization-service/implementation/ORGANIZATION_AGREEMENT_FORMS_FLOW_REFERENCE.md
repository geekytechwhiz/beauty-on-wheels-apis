# Organization Agreement & Forms Flow Reference

This document captures the onboarding forms-assignment step (Agreement & Forms).

## Step Context

- Parent: `TLH-114 Org Onboarding and Metadata`
- UI step: `Agreement & Forms`
- Sequence position: post-linking, during onboarding finalization

## Repository Mapping

- Documentation repo: `api-hub`
- Endpoint definition repo: `Common-Backend`
- Module owning endpoint: `forms_module`
- Infra evidence file: `Common-Backend/forms_module/saml.yaml`
- Handler path: `Common-Backend/forms_module/assign_org_form/index.js`

## API Called (Observed)

- Endpoint: `POST /dev/assign-org-forms`
- Base URL example: `https://v1w4b4vunl.execute-api.us-east-1.amazonaws.com`
- Full example: `POST https://v1w4b4vunl.execute-api.us-east-1.amazonaws.com/dev/assign-org-forms`
- Body example:
  - `organizationId: "mo9n6qxbf30ab20b"`
  - `forms: [{ formId, formVersion, formType }]`

## Route Evidence (`forms_module/saml.yaml`)

Route/function mapping:

- Function: `${Stage}_assign_org_forms`
- API resource path: `assign-org-forms`
- Method: `POST`

Related endpoints in the same module:

- `POST /get-root-forms`
- `POST /get-forms`
- `POST /get-app-forms`

## Implementation Trace

- Handler: `forms_module/assign_org_form/index.js`
- DB access: `forms_module/assign_org_form/dynamodB.js`
- Validation: `forms_module/assign_org_form/input-validation.js`

Flow summary:

1. For each requested form, fetch canonical form definition from `ROOT` org namespace.
2. Copy form/document into target organization namespace.
3. Set org-level form alert flag in user table.
4. Return success or partial-failure response.

## Where Data Is Stored

### 1) Forms Assignment Data

Stored in `FORMS_TABLE` (env-driven table name), with org-scoped keys:

- For form type `FORM`:
  - `pk = FORM#{organizationId}`
  - `sk = FORM#{formId}#{formVersion}`
- For form type `DOCUMENT`:
  - `pk = DOCUMENT#{organizationId}`
  - `sk = DOCUMENT#{docuId}#{version}`

Additional fields include:

- `organizationId`
- `assignedBy`
- `createdAt`
- copied metadata from root form/document

### 2) Org Form Alert Flag

Also updates `USER_TABLE`:

- `pk = ORG_LIST`
- `sk = ORG#{organizationId}`
- sets `formAlert = true`

## Expected Verification Checklist

After calling `POST /assign-org-forms`, verify:

1. `FORMS_TABLE` contains new org-scoped item(s) for requested `formId/formVersion`.
2. Item keys match expected `FORM#...` or `DOCUMENT#...` pattern.
3. `assignedBy` is populated with caller user id.
4. `USER_TABLE` org list row has `formAlert = true`.
5. For partial failures, API returns `207` with per-form error list.

## Risks / Notes

- If root form/version does not exist, item is not copied and returns `NO_FORM_DATA_FOUND`.
- This flow writes to two tables (`FORMS_TABLE`, `USER_TABLE`), so audit both.
- Do not paste long-lived bearer tokens in shared docs. Redact or rotate tokens before saving.
