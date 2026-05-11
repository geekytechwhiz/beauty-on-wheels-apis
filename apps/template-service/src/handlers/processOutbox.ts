import { getTemplateRuntime } from '../runtime';

function shouldSkipMissingOutboxResource(error: unknown): boolean {
  return process.env.IS_OFFLINE === 'true' && error instanceof Error && error.name === 'ResourceNotFoundException';
}

export const main = async () => {
  try {
    return await getTemplateRuntime().processTemplateOutboxUseCase.execute();
  } catch (error) {
    if (shouldSkipMissingOutboxResource(error)) {
      console.warn(
        'Skipping processTemplateOutbox in serverless-offline because the template outbox table or GSI2 is not available yet.',
      );
      return { processed: 0, skipped: true };
    }

    throw error;
  }
};
