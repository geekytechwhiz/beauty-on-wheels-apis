import { withApiHandler, createdResponse } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getCustomerPlanPaymentsService } from '../services/customer-plan-payments.service';
import { getCustomerPlansService } from '../services/customer-plans.service';
import { getPackageVisitsService } from '../services/package-visits.service';

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

export const handleListPlanVisits = withApiHandler(
  { operation: 'listplanvisits' },
  async (request: LambdaRequest) => getPackageVisitsService().list(request),
);

export const handleGetPlanVisit = withApiHandler(
  { operation: 'getplanvisit' },
  async (request: LambdaRequest) => getPackageVisitsService().get(request),
);

export const handleSchedulePlanVisit = withApiHandler(
  { operation: 'scheduleplanvisit', useLegacyResponseFormat: true },
  async (request: LambdaRequest) => {
    const data = await getPackageVisitsService().schedule(request);
    return createdResponse(data, {
      title: 'VISIT_SCHEDULED',
      description: 'Package visit scheduled and capacity reserved',
      severity: 'SUCCESS',
    }, correlationOf(request));
  },
);

export const handleReschedulePlanVisit = withApiHandler(
  { operation: 'rescheduleplanvisit' },
  async (request: LambdaRequest) => getPackageVisitsService().reschedule(request),
);

export const handleCancelPlanVisit = withApiHandler(
  { operation: 'cancelplanvisit' },
  async (request: LambdaRequest) => getPackageVisitsService().cancel(request),
);

export const handleStartPlanVisit = withApiHandler(
  { operation: 'startplanvisit' },
  async (request: LambdaRequest) => getPackageVisitsService().start(request),
);

export const handleCompletePlanVisit = withApiHandler(
  { operation: 'completeplanvisit' },
  async (request: LambdaRequest) => getPackageVisitsService().complete(request),
);

export const handleConfirmPlanVisitSchedules = withApiHandler(
  { operation: 'confirmplanvisitschedules', useLegacyResponseFormat: true },
  async (request: LambdaRequest) => {
    const data = await getPackageVisitsService().confirmSchedules(request);
    return createdResponse(data, {
      title: 'VISIT_SCHEDULES_CONFIRMED',
      description: data.failed.length > 0
        ? 'Some package visits could not be scheduled'
        : 'Package visit schedules confirmed',
      severity: data.failed.length > 0 ? 'WARNING' : 'SUCCESS',
    }, correlationOf(request));
  },
);
