/**
 * FHIR gateway config: domain API URLs and endpoints for adapters.
 * See domainEndpoints.ts for env var names and optional config file usage.
 */
export {
  getDomainEndpoints,
  getUserServiceEndpoints,
  getDeviceServiceEndpoints,
  type DomainEndpointsConfig,
  type UserServiceEndpointConfig,
  type DeviceServiceEndpointConfig,
} from './domainEndpoints';
