import { SchedulingCrewOptions, SchedulingCrewView, toSchedulingCrew } from '../domain/scheduling-crew';
import { CrewRepository, getCrewRepository } from '../repositories/crew.repository';
import { StaffRepository, getStaffRepository } from '../repositories/staff.repository';

export class SchedulingCrewsService {
  constructor(
    private readonly crews: CrewRepository = getCrewRepository(),
    private readonly staff: StaffRepository = getStaffRepository(),
  ) {}

  async list(vendorId: string, options: SchedulingCrewOptions = {}): Promise<{ crews: SchedulingCrewView[] }> {
    const [crewItems, staffItems] = await Promise.all([
      this.crews.listAllCrews(vendorId),
      this.staff.listAllStaff(vendorId),
    ]);
    const staffById = new Map(staffItems.map((item) => [item.staffId, item]));
    return {
      crews: crewItems
        .filter((crew) => crew.vendorId === vendorId && Boolean(crew.crewId))
        .map((crew) => toSchedulingCrew(crew, staffById, options)),
    };
  }
}

let service: SchedulingCrewsService;

export function getSchedulingCrewsService(): SchedulingCrewsService {
  if (!service) service = new SchedulingCrewsService();
  return service;
}
