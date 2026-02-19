/**
 * Structured logging for production
 */
export declare const logger: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, error?: Error, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
};
