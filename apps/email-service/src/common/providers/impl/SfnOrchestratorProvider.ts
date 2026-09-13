import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import {
  IOrchestratorProvider,
  StartExecutionOptions,
  StartExecutionResponse,
} from '../IOrchestratorProvider.js';
import { logger } from '../../utils/logger.js';

import { environment } from '../../config/environment.js';

export class SfnOrchestratorProvider implements IOrchestratorProvider {
  private client: SFNClient;

  constructor(region: string) {
    const config: any = { region };
    if (environment.isOffline) {
      config.endpoint = environment.sfnEndpoint;
      config.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
    }
    this.client = new SFNClient(config);
  }

  async startExecution(options: StartExecutionOptions): Promise<StartExecutionResponse> {
    try {
      const command = new StartExecutionCommand({
        stateMachineArn: options.stateMachineArn,
        name: options.name,
        input: JSON.stringify(options.input),
      });

      const response = await this.client.send(command);

      return {
        executionArn: response.executionArn || '',
        startDate: response.startDate || new Date(),
      };
    } catch (error) {
      logger.error('Error starting Step Functions execution', {
        error,
        stateMachineArn: options.stateMachineArn,
        executionName: options.name,
      });
      throw error;
    }
  }
}
