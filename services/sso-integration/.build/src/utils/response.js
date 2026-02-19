"use strict";
/**
 * API Gateway response utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonResponse = jsonResponse;
exports.successResponse = successResponse;
exports.errorResponse = errorResponse;
const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: CORS_HEADERS,
        body: JSON.stringify(body),
    };
}
function successResponse(data, statusCode = 200) {
    return jsonResponse(statusCode, { success: true, data });
}
function errorResponse(message, statusCode = 400, code) {
    return jsonResponse(statusCode, {
        success: false,
        error: code || 'ERROR',
        message,
    });
}
//# sourceMappingURL=response.js.map