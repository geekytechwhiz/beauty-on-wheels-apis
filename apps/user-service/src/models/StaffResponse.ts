import { BaseUserResponse } from './BaseUserResponse';

/**
 * Staff Response Interface
 * Extends BaseUserResponse with staff-specific fields
 */
export interface StaffResponse extends BaseUserResponse {
  sk2?: string; // specialty (stored as sk2 in DynamoDB)
}
