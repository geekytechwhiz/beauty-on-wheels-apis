import { withApiHandler } from '@api-hub/middleware';
import { ApiResponse, LambdaRequest } from '@api-hub/utils';

import { getServiceVisitsController } from '../controllers/service-visits.controller';

const controller = getServiceVisitsController();

export const handlePostServiceVisits = withApiHandler(
  { operation: 'postservicevisits', useLegacyResponseFormat: true },
  async (request: LambdaRequest) => ApiResponse.created(
    await controller.create(request),
    {
      title: 'SUCCESS',
      description: 'Service visit created',
      severity: 'SUCCESS',
    },
    { correlationId: request.context.correlationId },
  ),
);

export const handleGetServiceVisits = withApiHandler(
  { operation: 'getservicevisits' },
  async (request: LambdaRequest) => controller.list(request),
);

export const handleGetServiceVisit = withApiHandler(
  { operation: 'getservicevisit' },
  async (request: LambdaRequest) => controller.get(request),
);

export const handlePatchServiceVisit = withApiHandler(
  { operation: 'patchservicevisit' },
  async (request: LambdaRequest) => controller.update(request),
);

export const handleActivateServiceVisit = withApiHandler(
  { operation: 'activateservicevisit' },
  async (request: LambdaRequest) => controller.activate(request),
);

export const handlePauseServiceVisit = withApiHandler(
  { operation: 'pauseservicevisit' },
  async (request: LambdaRequest) => controller.pause(request),
);

export const handleArchiveServiceVisit = withApiHandler(
  { operation: 'archiveservicevisit' },
  async (request: LambdaRequest) => controller.archive(request),
);
