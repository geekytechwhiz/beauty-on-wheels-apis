import { buildHealthHandler } from '@api-hub/template';

/**
 * Health check handler for the template service
 * @param event - The event object
 * @param context - The context object
 * @returns The health check response
 */
export const main = buildHealthHandler();
