export interface ValidationIssue {
  validator: string;
  resourceType: string;
  path: string;
  code: string;
  message: string;
}