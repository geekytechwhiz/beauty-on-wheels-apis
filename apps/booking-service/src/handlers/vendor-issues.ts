import { withApiHandler, createdResponse } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getVendorIssuesService } from '../services/vendor-issues.service';
import { getVisitCompletionService } from '../services/visit-completion.service';

const correlationOf = (request: LambdaRequest) => ({
  correlationId: (request.context as { correlationId?: string } | undefined)?.correlationId,
});

export const handleCreateVendorIssue = withApiHandler(
  { operation: 'createvendorissue', useLegacyResponseFormat: true },
  async (request: LambdaRequest) => {
    const data = await getVendorIssuesService().create(request);
    return createdResponse(data, {
      title: 'ISSUE_CREATED',
      description: 'Issue filed. The linked visit, if any, is unchanged.',
      severity: 'SUCCESS',
    }, correlationOf(request));
  },
);

export const handleListVendorIssues = withApiHandler(
  { operation: 'listvendorissues' },
  async (request: LambdaRequest) => getVendorIssuesService().list(request),
);

export const handleGetVendorIssue = withApiHandler(
  { operation: 'getvendorissue' },
  async (request: LambdaRequest) => getVendorIssuesService().get(request),
);

export const handleCreateIssueAttachmentUploadUrl = withApiHandler(
  { operation: 'createissueattachmentuploadurl' },
  async (request: LambdaRequest) => getVendorIssuesService().attachmentUploadUrl(request),
);

export const handleConfirmIssueAttachment = withApiHandler(
  { operation: 'confirmissueattachment' },
  async (request: LambdaRequest) => getVendorIssuesService().confirmAttachment(request),
);

export const handleCreateVisitEvidenceUploadUrl = withApiHandler(
  { operation: 'createvisitevidenceuploadurl' },
  async (request: LambdaRequest) => getVisitCompletionService().evidenceUploadUrl(request),
);

export const handleOpsListIssues = withApiHandler(
  { operation: 'opslistissues' },
  async (request: LambdaRequest) => getVendorIssuesService().opsList(request),
);

export const handleOpsTriageIssue = withApiHandler(
  { operation: 'opstriageissue' },
  async (request: LambdaRequest) => getVendorIssuesService().opsAction(request, 'triage'),
);

export const handleOpsAssignIssue = withApiHandler(
  { operation: 'opsassignissue' },
  async (request: LambdaRequest) => getVendorIssuesService().opsAction(request, 'assign'),
);

export const handleOpsResolveIssue = withApiHandler(
  { operation: 'opsresolveissue' },
  async (request: LambdaRequest) => getVendorIssuesService().opsAction(request, 'resolve'),
);

export const handleOpsRequestIssueAction = withApiHandler(
  { operation: 'opsrequestissueaction' },
  async (request: LambdaRequest) => getVendorIssuesService().opsAction(request, 'request-action'),
);

export const handleOpsReviewVisitCompletion = withApiHandler(
  { operation: 'opsreviewvisitcompletion' },
  async (request: LambdaRequest) => getVisitCompletionService().review(request),
);
