import { APIGatewayProxyEvent } from 'aws-lambda';
import { s3Service } from '../../controllers/file-upload.controller';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
  

    const folder = event.queryStringParameters?.folder;

    if (!folder) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: 'folder query parameter is required',
        }),
      };
    }

    const files = await s3Service.listFiles(folder);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ files }),
    };
  } catch (error) {
    console.error(error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Unable to list files',
      }),
    };
  }
};
