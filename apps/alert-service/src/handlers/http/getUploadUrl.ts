import { APIGatewayProxyEvent } from "aws-lambda";
import { s3Service } from "../../controllers/file-upload.controller";

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
      body: JSON.stringify(response)
    };

  } catch (error) {

    console.error(error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Unable to generate upload URL"
      })
    };
  }
};