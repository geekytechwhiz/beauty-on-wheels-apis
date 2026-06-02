import { APIGatewayProxyEvent } from "aws-lambda";
import { s3Service } from "../../controllers/file-upload.controller";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

export const handler = async (
  event: APIGatewayProxyEvent
) => {
  try {

    const body = JSON.parse(
      event.body || "{}"
    );

    const {
      folder,
      fileName,
      contentType
    } = body;

    if (
      !folder ||
      !fileName ||
      !contentType
    ) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Missing required fields"
        })
      };
    }

    const response =
      await s3Service.generateUploadUrl(
        folder,
        fileName,
        contentType
      );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response)
    };

  } catch (error) {

    console.error(error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Unable to generate upload URL"
      })
    };
  }
};