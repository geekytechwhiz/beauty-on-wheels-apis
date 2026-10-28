import { withApiHandler, createdResponse } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getCustomerPlanPaymentsService } from '../services/customer-plan-payments.service';
import { getCustomerPlansService } from '../services/customer-plans.service';

const correlationOf = (request: LambdaRequest) => ({
  correlationId: (request.context as { correlationId?: string } | undefined)?.correlationId,
});

export const handlePostCustomerPlan = withApiHandler(
  { operation: 'postcustomerplan', useLegacyResponseFormat: true },
  async (request: LambdaRequest) => {
    const data = await getCustomerPlansService().create(request);
    return createdResponse(data, {
      title: 'CUSTOMER_PLAN_CREATED',
      description: 'Customer plan created and awaiting payment',
      severity: 'SUCCESS',
    }, correlationOf(request));
  },
);

export const handleListCustomerPlans = withApiHandler(
  { operation: 'getcustomerplans' },
  async (request: LambdaRequest) => getCustomerPlansService().list(request),
);

export const handleGetCustomerPlan = withApiHandler(
  { operation: 'getcustomerplan' },
  async (request: LambdaRequest) => getCustomerPlansService().get(request),
);

export const handlePostPlanPayment = withApiHandler(
  { operation: 'postcustomerplanpayment', useLegacyResponseFormat: true },
  async (request: LambdaRequest) => {
    const data = await getCustomerPlanPaymentsService().initiate(request);
    return createdResponse(data, {
      title: 'PAYMENT_INITIATED',
      description: 'Payment initiated for customer plan',
      severity: 'SUCCESS',
    }, correlationOf(request));
  },
);

export const handleGetPlanPayment = withApiHandler(
  { operation: 'getcustomerplanpayment' },
  async (request: LambdaRequest) => getCustomerPlanPaymentsService().getPayment(request),
);

export const handleSandboxCompletePlanPayment = withApiHandler(
  { operation: 'sandboxcompleteplanpayment' },
  async (request: LambdaRequest) => getCustomerPlanPaymentsService().sandboxComplete(request),
);

export const handleConfirmPlanPayment = withApiHandler(
  { operation: 'confirmcustomerplanpayment' },
  async (request: LambdaRequest) => getCustomerPlanPaymentsService().confirmProviderPayment(request),
);
