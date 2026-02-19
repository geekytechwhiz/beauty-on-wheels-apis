/**
 * API Gateway response utilities
 */
import { APIGatewayProxyResult } from 'aws-lambda';
export declare function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult;
export declare function successResponse(data: unknown, statusCode?: number): APIGatewayProxyResult;
export declare function errorResponse(message: string, statusCode?: number, code?: string): APIGatewayProxyResult;
