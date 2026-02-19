"use strict";
/**
 * Structured logging for production
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.logger = {
    info: (message, meta) => {
        console.log(JSON.stringify({ level: 'INFO', message, ...meta, timestamp: new Date().toISOString() }));
    },
    error: (message, error, meta) => {
        console.error(JSON.stringify({
            level: 'ERROR',
            message,
            error: error?.message,
            stack: error?.stack,
            ...meta,
            timestamp: new Date().toISOString(),
        }));
    },
    warn: (message, meta) => {
        console.warn(JSON.stringify({ level: 'WARN', message, ...meta, timestamp: new Date().toISOString() }));
    },
};
//# sourceMappingURL=logger.js.map