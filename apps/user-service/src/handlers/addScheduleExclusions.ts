import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { addScheduleExclusions } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return addScheduleExclusions(event, context);
};
