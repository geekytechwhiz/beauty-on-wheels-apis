export interface StartExecutionOptions {
  stateMachineArn: string;
  name: string;
  input: Record<string, any>;
}

export interface StartExecutionResponse {
  executionArn: string;
  startDate: Date;
}

export interface IOrchestratorProvider {
  startExecution(options: StartExecutionOptions): Promise<StartExecutionResponse>;
}
