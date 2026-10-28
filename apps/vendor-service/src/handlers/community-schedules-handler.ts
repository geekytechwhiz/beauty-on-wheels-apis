import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { validateCommunityScheduleRequest } from '../schemas/community-schedules.schema';
import { getCommunitySchedulesService } from '../services/community-schedules.service';
const service = getCommunitySchedulesService();
export const handlePutVendorCommunitySchedule = withApiHandler(
  {
    operation: 'putvendorcommunityschedule',
    validator: (request: LambdaRequest): void => {
      validateCommunityScheduleRequest(request);
    },
  },
  async (request: LambdaRequest) => service.put(request),
);
