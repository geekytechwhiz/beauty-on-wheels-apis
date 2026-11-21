import { withApiHandler, createdResponse } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getPaymentsService } from '../services/payments.service';

export const handlePostPayment = withApiHandler(
  {
    operation: 'postbookingpayment',
    useLegacyResponseFormat: true,
  },
  async (request: LambdaRequest) => {
    const data = await getPaymentsService().initiate(request);
    return createdResponse(data, {
      title: 'PAYMENT_INITIATED',
      description: 'Payment initiated for booking',
      severity: 'SUCCESS',
    }, {
      correlationId: (request.context as { correlationId?: string } | undefined)?.correlationId,
    });
  },
);

export const handleGetPayment = withApiHandler(
  { operation: 'getbookingpayment' },
  async (request: LambdaRequest) => getPaymentsService().getPayment(request),
);

/** Customer checkout callback; the service verifies the provider signature. */
export const handleConfirmProviderPayment = withApiHandler(
  { operation: 'confirmbookingpayment' },
  async (request: LambdaRequest) => getPaymentsService().confirmProviderPayment(request),
);

export const handleSandboxCompletePayment = withApiHandler(
  { operation: 'sandboxcompletepayment' },
  async (request: LambdaRequest) => getPaymentsService().sandboxComplete(request),
);
