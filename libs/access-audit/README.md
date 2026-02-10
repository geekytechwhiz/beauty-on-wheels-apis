# @api-hub/access-audit

Access audit logging for FHIR and other APIs. Log every access (read/create/update/delete) for compliance. Storage is injectable via `setAccessAuditStorage` (e.g. DynamoDB or Firehose); default is no-op.

## Usage

```ts
import { logAccessAudit, setAccessAuditStorage } from '@api-hub/access-audit';

// Optional: set storage at Lambda/app init
setAccessAuditStorage(myDynamoDBStorage);

await logAccessAudit({
  action: 'R',
  resourceType: 'Patient',
  resourceId: id,
  agentId: auth.subjectId,
  clientId: auth.clientId,
  tenantId: auth.tenantId,
  outcome: '0',
});
```
