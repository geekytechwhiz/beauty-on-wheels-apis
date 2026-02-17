import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { getSchedulePreferences } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return getSchedulePreferences(event, context);
};
