import type { Handler } from 'aws-lambda';
import { deliverSubscription } from '../subscriptions';

export const handler: Handler = async (event) => {
  await deliverSubscription(event as unknown as Parameters<typeof deliverSubscription>[0]);
  return { statusCode: 200 };
};
