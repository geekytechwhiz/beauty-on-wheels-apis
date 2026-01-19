import axios from 'axios';
import { createLogger } from '@api-hub/logger';
const logger = createLogger({ service: 'user-service', redactPII: true });

export class OrganizationRepository {
  async getOrganization(organizationId: string, authHeader?: string): Promise<any | null> {
    const apiBaseUrl = process.env.ORGANIZATION_API_URL;
    logger.info({ event: 'Fetching organization details', organizationId });
    if (!apiBaseUrl) {
      logger.error({ event: 'Organization API URL not configured', organizationId });
      return null;
    }

    try {
      const url = `${apiBaseUrl.replace(/\/$/, '')}/${organizationId}`;
      const response = await axios.get(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
      });
      const payload = response.data?.data || response.data || null;
      logger.info({
        event: 'Organization API response',
        status: response.status,
        organizationId,
        hasData: payload !== null,
      });
      return payload;
    } catch (err) {
      const error = err as any;
      const status = error?.response?.status;
      logger.error({
        event: 'Error fetching organization details',
        err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
        status,
        organizationId,
      });
      return null;
    }
  }
}
