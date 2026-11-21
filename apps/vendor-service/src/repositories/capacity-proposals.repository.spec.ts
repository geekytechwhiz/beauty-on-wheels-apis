import { ConditionalWriteConflictError } from '@api-hub/utils';

import { CAPACITY_COMMITMENT_STATUS } from '../domain/capacity-commitment';
import { CapacityProposalsRepository } from './capacity-proposals.repository';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

describe('CapacityProposalsRepository.reserveSoldCapacity', () => {
  it('rejects the transaction when sold quantity plus demand would exceed commitment quantity', async () => {
    const repo = new CapacityProposalsRepository();
    const transactWrite = jest
      .spyOn(repo as unknown as { transactWrite: () => Promise<void> }, 'transactWrite')
      .mockRejectedValue(new ConditionalWriteConflictError(new Error('oversold')));

    await expect(
      repo.reserveSoldCapacity({
        vendorId: 'vendor_1',
        commitmentId: 'cmt_1',
        quantity: 4,
        commitmentQuantity: 10,
        idempotencyKey: 'plan-1',
        planId: 'plan-1',
      }),
    ).rejects.toBeInstanceOf(ConditionalWriteConflictError);

    expect(transactWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        TransactItems: expect.arrayContaining([
          expect.objectContaining({
            Update: expect.objectContaining({
              Key: {
                PK: VendorKeyBuilder.vendorPk('vendor_1'),
                SK: VendorKeyBuilder.capacityCommitmentSk('cmt_1'),
              },
              ConditionExpression: expect.stringContaining(
                'reservedSoldQuantity <= :maxReserved',
              ),
              ExpressionAttributeValues: expect.objectContaining({
                ':delta': 4,
                ':commitmentQuantity': 10,
                ':maxReserved': 6,
                ':holdingStatus0': CAPACITY_COMMITMENT_STATUS.ACTIVE,
              }),
            }),
          }),
        ]),
      }),
    );

    transactWrite.mockRestore();
  });
});
