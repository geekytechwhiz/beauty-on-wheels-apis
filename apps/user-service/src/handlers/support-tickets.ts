import { createdResponse, withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getSupportTicketsController } from '../controllers/support-tickets.controller';
import { validateSupportTicketCreate } from '../schemas/support-tickets.schema';

const controller = getSupportTicketsController();

export const handleCreateSupportTicket = withApiHandler(
  {
    operation: 'createSupportTicket',
    useLegacyResponseFormat: true,
    validator: (request: LambdaRequest) => {
      validateSupportTicketCreate(request);
    },
  },
  async (request: LambdaRequest) => {
    const data = await controller.create(request);
    return createdResponse(
      data,
      {
        title: 'SUPPORT_TICKET_CREATED',
        description: 'Support ticket submitted',
        severity: 'SUCCESS',
      },
      {
        correlationId: (request.context as { correlationId?: string } | undefined)
          ?.correlationId,
      },
    );
  },
);

export const handleListSupportTickets = withApiHandler(
  { operation: 'listSupportTickets' },
  async (request: LambdaRequest) => controller.list(request),
);

export const handleGetSupportTicket = withApiHandler(
  { operation: 'getSupportTicket' },
  async (request: LambdaRequest) => controller.get(request),
);
