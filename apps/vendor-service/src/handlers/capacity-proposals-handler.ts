import { LambdaRequest } from '@api-hub/utils';

import { getCapacityProposalsController } from '../controllers/capacity-proposals.controller';
import {
  validateAcceptCapacityProposalRequest,
  validateCounterCapacityProposalRequest,
  validateCreateCapacityProposalRequest,
  validateDeclineCapacityProposalRequest,
  validateReviseCapacityProposalRequest,
  validateSendCapacityProposalRequest,
} from '../schemas/capacity-proposals.schema';
import { withVendorApiHandler } from './with-vendor-handler';

const controller = getCapacityProposalsController();

export const handleCreatecapacityproposal = withVendorApiHandler(
  {
    operation: 'createcapacityproposal',
    validator: (request: LambdaRequest) => {
      validateCreateCapacityProposalRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleCreatecapacityproposal(request),
);

export const handleSendcapacityproposal = withVendorApiHandler(
  {
    operation: 'sendcapacityproposal',
    validator: (request: LambdaRequest) => {
      validateSendCapacityProposalRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleSendcapacityproposal(request),
);

export const handleAcceptcapacitycounter = withVendorApiHandler(
  {
    operation: 'acceptcapacitycounter',
    validator: (request: LambdaRequest) => {
      validateAcceptCapacityProposalRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleAcceptcapacitycounter(request),
);

export const handleRevisecapacityproposal = withVendorApiHandler(
  {
    operation: 'revisecapacityproposal',
    validator: (request: LambdaRequest) => {
      validateReviseCapacityProposalRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleRevisecapacityproposal(request),
);

export const handleDeclinecapacityproposal = withVendorApiHandler(
  {
    operation: 'declinecapacityproposal',
    validator: (request: LambdaRequest) => {
      validateDeclineCapacityProposalRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleDeclinecapacityproposal(request),
);

export const handleListcapacityproposals = withVendorApiHandler(
  {
    operation: 'listcapacityproposals',
  },
  async (request: LambdaRequest) => controller.handleListcapacityproposals(request),
);

export const handleGetcapacityproposal = withVendorApiHandler(
  {
    operation: 'getcapacityproposal',
  },
  async (request: LambdaRequest) => controller.handleGetcapacityproposal(request),
);

export const handleListvendorcapacitycommitments = withVendorApiHandler(
  {
    operation: 'listvendorcapacitycommitments',
  },
  async (request: LambdaRequest) => controller.handleListvendorcapacitycommitments(request),
);

export const handleOpslistcapacitycommitments = withVendorApiHandler(
  {
    operation: 'opslistcapacitycommitments',
  },
  async (request: LambdaRequest) => controller.handleOpslistcapacitycommitments(request),
);

export const handleGetcapacitycommitment = withVendorApiHandler(
  {
    operation: 'getcapacitycommitment',
  },
  async (request: LambdaRequest) => controller.handleGetcapacitycommitment(request),
);

export const handleListvendorcapacityproposals = withVendorApiHandler(
  {
    operation: 'listvendorcapacityproposals',
  },
  async (request: LambdaRequest) => controller.handleListvendorcapacityproposals(request),
);

export const handleGetvendorcapacityproposal = withVendorApiHandler(
  {
    operation: 'getvendorcapacityproposal',
  },
  async (request: LambdaRequest) => controller.handleGetvendorcapacityproposal(request),
);

export const handleAcceptvendorcapacityproposal = withVendorApiHandler(
  {
    operation: 'acceptvendorcapacityproposal',
    validator: (request: LambdaRequest) => {
      validateAcceptCapacityProposalRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleAcceptvendorcapacityproposal(request),
);

export const handleCountervendorcapacityproposal = withVendorApiHandler(
  {
    operation: 'countervendorcapacityproposal',
    validator: (request: LambdaRequest) => {
      validateCounterCapacityProposalRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleCountervendorcapacityproposal(request),
);

export const handleDeclinevendorcapacityproposal = withVendorApiHandler(
  {
    operation: 'declinevendorcapacityproposal',
    validator: (request: LambdaRequest) => {
      validateDeclineCapacityProposalRequest(request);
    },
  },
  async (request: LambdaRequest) => controller.handleDeclinevendorcapacityproposal(request),
);
