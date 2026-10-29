import {
  Crew,
  CrewMember,
  CrewStatus,
  CreateCrewRequest,
} from '../types/api-types';
import { CrewDdbItem, StaffDdbItem } from '../types/repository.types';
import {
  CREW_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

export class CrewMapper {
  static toDomain(
    item: CrewDdbItem,
    staffById: Map<string, StaffDdbItem>,
  ): Crew {
    return {
      crewId: item.crewId,
      vendorId: item.vendorId,
      name: item.name,
      vanLabel: item.vanLabel,
      staffIds: item.staffIds,
      members: item.staffIds.map((staffId) => CrewMapper.toMember(staffId, staffById.get(staffId))),
      status: item.status,
      revision: item.revision,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toMember(staffId: string, staff?: StaffDdbItem): CrewMember {
    if (!staff) {
      return { staffId, status: 'INACTIVE' };
    }
    return {
      staffId,
      name: staff.name,
      status: staff.status,
    };
  }

  static toDdbItem(
    request: CreateCrewRequest & { status?: CrewStatus },
    vendorId: string,
    crewId: string,
  ): CrewDdbItem {
    const timestamp = new Date().toISOString();
    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.crewSk(crewId),
      crewId,
      vendorId,
      name: request.name,
      vanLabel: request.vanLabel,
      staffIds: request.staffIds,
      status: request.status ?? 'ACTIVE',
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      entityType: CREW_ENTITY_TYPE,
    };
  }
}
