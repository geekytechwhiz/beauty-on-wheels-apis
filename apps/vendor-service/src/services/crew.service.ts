import { randomUUID } from 'crypto';
import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ConditionalWriteConflictError,
  NotFoundError,
  ValidationError,
  isConditionalWriteConflictAtIndex,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { assertCrewComposition } from '../domain/crew';
import { VENDOR_CAPABILITY, VendorCapability } from '../domain/vendor-self';
import { CrewMapper } from '../mappers/crew.mapper';
import {
  CrewRepository,
  CrewPageResult,
  getCrewRepository,
} from '../repositories/crew.repository';
import {
  StaffRepository,
  getStaffRepository,
} from '../repositories/staff.repository';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import {
  Crew,
  CrewListResponse,
  CrewStatus,
  CreateCrewRequest,
  UpdateCrewRequest,
} from '../types/api-types';
import { CrewDdbItem, StaffDdbItem, VendorDdbItem } from '../types/repository.types';
import {
  assertVendorAction,
  decodeCursor,
  encodeCursor,
  getAuthenticatedUserId,
  getPathParam,
  getVendorId,
  isAdminCaller,
  isVendorOwner,
  parseLimit,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'crew-service',
  redactPII: true,
});

const CREW_STATUSES: CrewStatus[] = ['ACTIVE', 'INACTIVE'];

export class CrewService {
  private readonly logger = createChildLogger(baseLogger, { service: 'CrewService' });

  constructor(
    private readonly repository: CrewRepository = getCrewRepository(),
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
    private readonly staffRepository: StaffRepository = getStaffRepository(),
  ) {}

  async listvendorcrews(request: LambdaRequest): Promise<CrewListResponse> {
    const vendorId = getVendorId(request);
    const status = request.params?.status as string | undefined;
    await this.requireAction(request, vendorId, VENDOR_CAPABILITY.CREW_VIEW);
    if (status && !CREW_STATUSES.includes(status as CrewStatus)) {
      throw new ValidationError(`Invalid status. Supported values: ${CREW_STATUSES.join(', ')}`);
    }
    const result = await this.repository.listCrews({
      vendorId,
      status: status as CrewStatus | undefined,
      limit: parseLimit(request.params?.limit),
      lastEvaluatedKey: decodeCursor(request.params?.cursor),
    });
    return this.toListResponse(vendorId, result);
  }

  async createvendorcrew(request: LambdaRequest): Promise<Crew> {
    const vendorId = getVendorId(request);
    const body = request.body as CreateCrewRequest;
    await this.requireAction(request, vendorId, VENDOR_CAPABILITY.CREW_MANAGE);
    const composed = await this.compose(vendorId, {
      name: body.name,
      vanLabel: body.vanLabel,
      staffIds: body.staffIds,
      status: 'ACTIVE',
    });
    const item = CrewMapper.toDdbItem(
      { ...body, name: composed.name, vanLabel: composed.vanLabel, staffIds: composed.staffIds },
      vendorId,
      randomUUID(),
    );
    try {
      await this.repository.createCrew(item);
    } catch (error) {
      if (isConditionalWriteConflictAtIndex(error, 0)) {
        throw new NotFoundError('Vendor not found');
      }
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Crew already exists');
      }
      throw error;
    }
    return this.present(vendorId, item);
  }

  async getvendorcrew(request: LambdaRequest): Promise<Crew> {
    const vendorId = getVendorId(request);
    const crewId = getPathParam(request, 'crewId');
    await this.requireAction(request, vendorId, VENDOR_CAPABILITY.CREW_VIEW);
    const item = await this.requireCrew(vendorId, crewId);
    return this.present(vendorId, item);
  }

  async updatevendorcrew(request: LambdaRequest): Promise<Crew> {
    const vendorId = getVendorId(request);
    const crewId = getPathParam(request, 'crewId');
    const body = request.body as UpdateCrewRequest;
    await this.requireAction(request, vendorId, VENDOR_CAPABILITY.CREW_MANAGE);
    const existing = await this.requireCrew(vendorId, crewId);
    if (body.revision !== undefined && body.revision !== existing.revision) {
      throw new ConflictError('Crew was updated by someone else');
    }
    const composed = await this.compose(vendorId, {
      name: body.name ?? existing.name,
      vanLabel: body.vanLabel ?? existing.vanLabel,
      staffIds: body.staffIds ?? existing.staffIds,
      status: body.status ?? existing.status,
    });
    const next: CrewDdbItem = {
      ...existing,
      name: composed.name,
      vanLabel: composed.vanLabel,
      staffIds: composed.staffIds,
      status: body.status ?? existing.status,
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.repository.updateCrew(next, existing.revision);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Crew was updated by someone else');
      }
      throw error;
    }
    return this.present(vendorId, { ...next, revision: existing.revision + 1 });
  }

  async deactivatevendorcrew(request: LambdaRequest): Promise<void> {
    const vendorId = getVendorId(request);
    const crewId = getPathParam(request, 'crewId');
    await this.requireAction(request, vendorId, VENDOR_CAPABILITY.CREW_MANAGE);
    const existing = await this.requireCrew(vendorId, crewId);
    const next: CrewDdbItem = {
      ...existing,
      status: 'INACTIVE',
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.repository.updateCrew(next, existing.revision);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Crew was updated by someone else');
      }
      throw error;
    }
  }

  private async compose(
    vendorId: string,
    input: { name: string; vanLabel: string; staffIds: string[]; status: CrewStatus },
  ) {
    const loaded = await Promise.all(input.staffIds.map(async (staffId) => {
      const staff = await this.staffRepository.getStaff(vendorId, staffId.trim());
      return staff ? { staffId: staff.staffId, status: staff.status } : undefined;
    }));
    return assertCrewComposition({ ...input, members: loaded });
  }

  private async requireCrew(vendorId: string, crewId: string): Promise<CrewDdbItem> {
    const item = await this.repository.getCrew(vendorId, crewId);
    if (!item || item.vendorId !== vendorId) {
      throw new NotFoundError('Crew not found');
    }
    return item;
  }

  private async requireAction(
    request: LambdaRequest,
    vendorId: string,
    action: VendorCapability,
  ): Promise<VendorDdbItem> {
    const userId = getAuthenticatedUserId(request);
    const vendor = await this.vendorsRepository.getVendorById(vendorId);
    if (!vendor) {
      throw new NotFoundError('Vendor not found');
    }
    if (isVendorOwner(vendor, userId) || isAdminCaller(request)) {
      return vendor;
    }
    const memberships = await this.staffRepository.listMembershipsByUserId(userId);
    const membership = memberships.find((item) => item.vendorId === vendorId);
    assertVendorAction(request, vendor, action, membership);
    this.logger.info({ event: 'crew_access_granted', userId, vendorId, action });
    return vendor;
  }

  private async present(vendorId: string, item: CrewDdbItem): Promise<Crew> {
    const staff = await this.staffRepository.listAllStaff(vendorId);
    return CrewMapper.toDomain(item, new Map(staff.map((member) => [member.staffId, member])));
  }

  private async toListResponse(vendorId: string, result: CrewPageResult): Promise<CrewListResponse> {
    const staff = await this.staffRepository.listAllStaff(vendorId);
    const staffById = new Map<string, StaffDdbItem>(staff.map((member) => [member.staffId, member]));
    return {
      data: result.items.map((item) => CrewMapper.toDomain(item, staffById)),
      pagination: {
        nextCursor: encodeCursor(result.lastEvaluatedKey),
        hasMore: Boolean(result.lastEvaluatedKey),
      },
    };
  }
}

let service: CrewService;

export function getCrewService() {
  if (!service) {
    service = new CrewService();
  }
  return service;
}
