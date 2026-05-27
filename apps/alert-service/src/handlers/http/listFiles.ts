import { APIGatewayProxyEvent } from 'aws-lambda';
import { s3Service } from '../../controllers/file-upload.controller';

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const folder = event.queryStringParameters?.folder;

    if (!folder) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: 'folder query parameter is required',
        }),
      };
    }

    const files = await s3Service.listFiles(folder);

    return {
      statusCode: 200,
      body: JSON.stringify({ files }),
    };
  } catch (error) {
    console.error(error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Unable to list files',
      }),
    };
  }
};
