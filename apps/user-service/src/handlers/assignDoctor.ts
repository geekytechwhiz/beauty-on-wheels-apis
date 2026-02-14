import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { assignDoctor as assignDoctorHandler } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return assignDoctorHandler(event, context);
};
