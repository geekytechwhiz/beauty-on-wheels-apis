import { SQSEvent } from 'aws-lambda';
import { userReminderEvent } from './sqsHandler';

export const main = async (event: SQSEvent): Promise<void> => {
  return userReminderEvent(event);
};
