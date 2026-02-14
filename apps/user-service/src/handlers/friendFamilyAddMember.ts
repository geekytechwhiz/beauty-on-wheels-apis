import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { friendFamilyAddMember } from './httpHandler';

export const main: APIGatewayProxyHandler = async (event, context: Context) => {
  return friendFamilyAddMember(event, context);
};
