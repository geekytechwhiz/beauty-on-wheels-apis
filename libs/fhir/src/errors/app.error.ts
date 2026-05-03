export interface AppError extends Error {
    statusCode?: number;
    code?: string;
    details?: {
      code?: string;
      field?: string;
      message: string;
    }[];
  }