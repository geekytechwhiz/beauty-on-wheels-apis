import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { listDoctorPatients as listDoctorPatientsHandler } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return listDoctorPatientsHandler(event, context);
};
