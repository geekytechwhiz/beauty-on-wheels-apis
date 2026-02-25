import { APIGatewayProxyEvent } from "aws-lambda";

export const health = async (event: APIGatewayProxyEvent) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'OK' }),
  };
};