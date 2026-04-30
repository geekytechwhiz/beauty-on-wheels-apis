/** OpenAPI workflow mutation actions — same values as legacy `@api-hub/alert` enum. */
export const AlertWorkflowAction = {
  StartWork: 'START_WORK',
  Wait: 'WAIT',
  Resume: 'RESUME',
  Resolve: 'RESOLVE',
  Dismiss: 'DISMISS',
} as const;
