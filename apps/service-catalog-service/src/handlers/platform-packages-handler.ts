import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getPlatformPackagesService } from '../services/platform-packages.service';

const service = getPlatformPackagesService();

export const listPlatformPackages = withApiHandler(
  { operation: 'listPlatformPackages' },
  (request: LambdaRequest) => service.listAdmin(request),
);
export const createPlatformPackage = withApiHandler(
  { operation: 'createPlatformPackage' },
  (request: LambdaRequest) => service.create(request),
);
export const getPlatformPackage = withApiHandler(
  { operation: 'getPlatformPackage' },
  (request: LambdaRequest) => service.get(request),
);
export const patchPlatformPackage = withApiHandler(
  { operation: 'patchPlatformPackage' },
  (request: LambdaRequest) => service.patch(request),
);
export const publishPlatformPackage = withApiHandler(
  { operation: 'publishPlatformPackage' },
  (request: LambdaRequest) => service.transition(request, 'published'),
);
export const pausePlatformPackage = withApiHandler(
  { operation: 'pausePlatformPackage' },
  (request: LambdaRequest) => service.transition(request, 'paused'),
);
export const resumePlatformPackage = withApiHandler(
  { operation: 'resumePlatformPackage' },
  (request: LambdaRequest) => service.transition(request, 'published'),
);
export const archivePlatformPackage = withApiHandler(
  { operation: 'archivePlatformPackage' },
  (request: LambdaRequest) => service.transition(request, 'archived'),
);
export const listAdminSalesControls = withApiHandler(
  { operation: 'listAdminSalesControls' },
  (request: LambdaRequest) => service.listSalesControls(request),
);
export const putPlatformPackageSalesControl = withApiHandler(
  { operation: 'putPlatformPackageSalesControl' },
  (request: LambdaRequest) => service.updateSalesControl(request),
);
export const discoverPlatformPackages = withApiHandler(
  { operation: 'discoverPlatformPackages' },
  (request: LambdaRequest) => service.discover(request),
);
export const getCustomerPlatformPackage = withApiHandler(
  { operation: 'getCustomerPlatformPackage' },
  (request: LambdaRequest) => service.getCustomerPackage(request),
);
