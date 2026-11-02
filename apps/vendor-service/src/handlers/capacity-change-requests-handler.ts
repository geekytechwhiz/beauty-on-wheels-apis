import { LambdaRequest } from '@api-hub/utils';

import { getCapacityChangeRequestsService } from '../services/capacity-change-requests.service';
import { withVendorApiHandler } from './with-vendor-handler';

const service = () => getCapacityChangeRequestsService();

export const handleCreatecapacitychangerequest = withVendorApiHandler(
  { operation: 'createcapacitychangerequest' },
  async (request: LambdaRequest) => service().create(request),
);

export const handleListcapacitychangerequests = withVendorApiHandler(
  { operation: 'listcapacitychangerequests' },
  async (request: LambdaRequest) => service().list(request),
);

export const handleOpslistcapacitychangerequests = withVendorApiHandler(
  { operation: 'opslistcapacitychangerequests' },
  async (request: LambdaRequest) => service().opsList(request),
);

export const handleOpsapprovecapacitychangerequest = withVendorApiHandler(
  { operation: 'opsapprovecapacitychangerequest' },
  async (request: LambdaRequest) => service().approve(request),
);

export const handleOpsrejectcapacitychangerequest = withVendorApiHandler(
  { operation: 'opsrejectcapacitychangerequest' },
  async (request: LambdaRequest) => service().reject(request),
);
