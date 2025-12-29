import { DynamoDBStreamEvent } from 'aws-lambda';
import { userProfileStreamHandler } from './streamHandler';

export const main = async (event: DynamoDBStreamEvent): Promise<void> => {
  return userProfileStreamHandler(event);
};
