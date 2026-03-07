import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildResponse } from './response-builder'; 
import { HttpStatus } from '../enums/http-status';
import { ResponseOptions } from '../types/core-types';
import { getErrorMessage, getMessage } from './message-resolver';

export class ApiResponse {

  static async ok<T>(
    event: APIGatewayProxyEvent,
    messageKey: string,
    data: T | null,
    options: ResponseOptions,
  ): Promise<APIGatewayProxyResult> {

    const message = await getMessage(event, messageKey);

    return buildResponse(
      HttpStatus.OK,
      message,
      data,
      options
    );
  }

  static async created<T>(
    event: APIGatewayProxyEvent,
    messageKey: string,
    data: T | null,
    options: ResponseOptions,
  ): Promise<APIGatewayProxyResult> {

    const message = await getMessage(event, messageKey);

    return buildResponse(
      HttpStatus.CREATED,
      message,
      data,
      options
    );
  }

  static async badRequest(
    event: APIGatewayProxyEvent,
    errorKey: string,
    options: ResponseOptions
  ) {

    const message = await getErrorMessage(event, errorKey);

    return buildResponse(
      HttpStatus.BAD_REQUEST,
      message,
      null,
      options
    );
  }

  static async unauthorized(
    event: APIGatewayProxyEvent,
    errorKey: string,
    options: ResponseOptions
  ) {

    const message = await getErrorMessage(event, errorKey);

    return buildResponse(
      HttpStatus.UNAUTHORIZED,
      message,
      null,
      options
    );
  }

  static async forbidden(
    event: APIGatewayProxyEvent,
    errorKey: string,
    options: ResponseOptions
  ) {

    const message = await getErrorMessage(event, errorKey);

    return buildResponse(
      HttpStatus.FORBIDDEN,
      message,
      null,
      options
    );
  }

  static async notFound(
    event: APIGatewayProxyEvent,
    errorKey: string,
    options: ResponseOptions
  ) {

    const message = await getErrorMessage(event, errorKey);

    return buildResponse(
      HttpStatus.NOT_FOUND,
      message,
      null,
      options
    );
  }

  static async conflict(
    event: APIGatewayProxyEvent,
    errorKey: string,
    options: ResponseOptions
  ) {

    const message = await getErrorMessage(event, errorKey);

    return buildResponse(
      HttpStatus.CONFLICT,
      message,
      null,
      options
    );
  }

  static async unprocessable(
    event: APIGatewayProxyEvent,
    errorKey: string,
    options: ResponseOptions
  ) {

    const message = await getErrorMessage(event, errorKey);

    return buildResponse(
      HttpStatus.UNPROCESSABLE_ENTITY,
      message,
      null,
      options
    );
  }

  static async tooManyRequests(
    event: APIGatewayProxyEvent,
    errorKey: string,
    options: ResponseOptions
  ) {

    const message = await getErrorMessage(event, errorKey);

    return buildResponse(
      HttpStatus.TOO_MANY_REQUESTS,
      message,
      null,
      options
    );
  }

  static async internalError(
    event: APIGatewayProxyEvent,
    errorKey: string,
    options: ResponseOptions
  ) {

    const message = await getErrorMessage(event, errorKey);

    return buildResponse(
      HttpStatus.INTERNAL_SERVER_ERROR,
      message,
      null,
      options
    );
  }

}