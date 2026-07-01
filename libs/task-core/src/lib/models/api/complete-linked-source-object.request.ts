export interface CompleteLinkedSourceObjectRequest {
  organizationId: string;
  patientId: string;
  completionSourceType: string;
  completionSourceReferenceId: string;
  completionEventId: string;
  completedAt: number;
}

export type CompleteLinkedSourceObjectTaskResult = {
  runtimeTaskInstanceId: string;
  outcome: 'completed' | 'skippedTerminal' | 'skippedDuplicate';
};

export type CompleteLinkedSourceObjectResult = {
  results: CompleteLinkedSourceObjectTaskResult[];
};
