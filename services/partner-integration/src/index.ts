/**
 * Partner Integration Service – external deployable service.
 * Handles all partner types (lab, clinic, hospital) via adapter registry in @api-hub/lab-integration.
 */
export { main as health } from './handlers/health';
export { main as createOrder } from './handlers/createOrder';
export { main as rescheduleOrder } from './handlers/rescheduleOrder';
export { main as cancelOrder } from './handlers/cancelOrder';
export { main as getOrderStatus } from './handlers/getOrderStatus';
export { main as getServiceableLocations } from './handlers/getServiceableLocations';
export { main as getPartnerLocation } from './handlers/getPartnerLocation';
export { main as searchPackages } from './handlers/searchPackages';
export { main as getPackageDetails } from './handlers/getPackageDetails';
export { main as getBookingSlots } from './handlers/getBookingSlots';
