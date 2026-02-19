"use strict";
/**
 * Health check endpoint
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const response_1 = require("../utils/response");
async function handler(_event, _context) {
    return (0, response_1.successResponse)({
        status: 'healthy',
        service: 'myvitalrx-sso',
        timestamp: new Date().toISOString(),
    });
}
//# sourceMappingURL=health.js.map