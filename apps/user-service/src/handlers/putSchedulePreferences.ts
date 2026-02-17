import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { putSchedulePreferences } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return putSchedulePreferences(event, context);
};
