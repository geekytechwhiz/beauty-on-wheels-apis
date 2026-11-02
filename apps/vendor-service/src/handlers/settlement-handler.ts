import { LambdaRequest } from '@api-hub/utils';

import { getSettlementLedgerService } from '../services/settlement-ledger.service';
import { withVendorApiHandler } from './with-vendor-handler';

const service = () => getSettlementLedgerService();

export const handleOpsgeneratesettlementstatement = withVendorApiHandler(
  { operation: 'opsgeneratesettlementstatement' },
  async (request: LambdaRequest) => service().generate(request),
);

export const handleListsettlementstatements = withVendorApiHandler(
  { operation: 'listsettlementstatements' },
  async (request: LambdaRequest) => service().listForVendor(request),
);

export const handleGetsettlementstatement = withVendorApiHandler(
  { operation: 'getsettlementstatement' },
  async (request: LambdaRequest) => service().getForVendor(request),
);

export const handleOpslistsettlementstatements = withVendorApiHandler(
  { operation: 'opslistsettlementstatements' },
  async (request: LambdaRequest) => service().opsList(request),
);

export const handleOpsapprovesettlementstatement = withVendorApiHandler(
  { operation: 'opsapprovesettlementstatement' },
  async (request: LambdaRequest) => service().approve(request),
);

export const handleOpsmarkpaidsettlementstatement = withVendorApiHandler(
  { operation: 'opsmarkpaidsettlementstatement' },
  async (request: LambdaRequest) => service().markPaid(request),
);

export const handleOpsholdsettlementstatement = withVendorApiHandler(
  { operation: 'opsholdsettlementstatement' },
  async (request: LambdaRequest) => service().hold(request),
);

export const handleOpsrejectsettlementstatement = withVendorApiHandler(
  { operation: 'opsrejectsettlementstatement' },
  async (request: LambdaRequest) => service().reject(request),
);

export const handleOpsdisputesettlementstatement = withVendorApiHandler(
  { operation: 'opsdisputesettlementstatement' },
  async (request: LambdaRequest) => service().dispute(request),
);
