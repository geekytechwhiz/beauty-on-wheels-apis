import { LambdaRequest, ConflictError, NotFoundError } from '@api-hub/utils';
import { CommunitiesRepository, getCommunitiesRepository } from '../repositories/communities.repository';
import { CommunitySchedulesRepository, getCommunitySchedulesRepository } from '../repositories/community-schedules.repository';
import { getVendorsRepository, VendorsRepository } from '../repositories/vendors.repository';
import { assertVendorAccess, getPathParam, getVendorId } from '../utils/helpers';
import { validateWeeklySchedule } from '../domain/community-schedule';

export class CommunitySchedulesService {
  constructor(private readonly schedules: CommunitySchedulesRepository = getCommunitySchedulesRepository(), private readonly communities: CommunitiesRepository = getCommunitiesRepository(), private readonly vendors: VendorsRepository = getVendorsRepository()) {}
  async put(request: LambdaRequest) {
    const vendorId = getVendorId(request); const communityId = getPathParam(request, 'communityId');
    const vendor = await this.vendors.getVendorById(vendorId); if (!vendor) throw new NotFoundError('Vendor not found');
    assertVendorAccess(request, vendor);
    if (vendor.status !== 'ACTIVE') throw new ConflictError('Community schedules can be configured after vendor approval');
    const assignments = await this.communities.listByVendor(vendorId);
    if (!assignments.some((item) => item.communityId === communityId)) throw new NotFoundError('Community is not assigned to this vendor');
    const body = request.body as { timezone: string; scheduleType: 'RECURRING'; weeklySchedule: unknown[] };
    validateWeeklySchedule(body.weeklySchedule as never);
    const existing = await this.schedules.getSchedule(vendorId, communityId); const now = new Date().toISOString();
    const item = { PK: `VENDOR#${vendorId}`, SK: `COMMUNITY_SCHEDULE#${communityId}`, vendorId, communityId, timezone: body.timezone, scheduleType: body.scheduleType, weeklySchedule: body.weeklySchedule, entityType: 'VendorCommunitySchedule' as const, createdAt: existing?.createdAt ?? now, updatedAt: now };
    await this.schedules.putSchedule(item); return { data: item };
  }
}
let service: CommunitySchedulesService;
export function getCommunitySchedulesService() { if (!service) service = new CommunitySchedulesService(); return service; }
