import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../errors/app.error';

// 1. Define your service keys and their corresponding base URLs
export const BASE_URLS = {
  booking:
    process.env.NEXT_PUBLIC_BOOKING_API_URL ||
    'https://ho3jui18ua.execute-api.ap-south-1.amazonaws.com/dev',
} as const;

export type ServiceName = keyof typeof BASE_URLS;

// 2. Factory function to create a configured Axios instance
const createAxiosClient = (baseURL: string): AxiosInstance => {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  const client = axios.create({
    baseURL,
    timeout: 10000,

    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  // Shared Request Interceptor (e.g., attach Auth Token)
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const token = process.env.INTERNAL_SERVICE_TOKEN;
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error: AxiosError) => Promise.reject(error),
  );

  // Shared Response Interceptor (e.g., global error handling)
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.response?.status === 401) {
        throw new UnauthorizedError('Unauthorized for this resource'+error.response?.data as string + ' with token '+token);
      } else if (error.response?.status === 403) {
        throw new ForbiddenError('Forbidden for this resource'+error.response?.data as string + ' with token '+token);
      } else if (error.response?.status === 404) {
        throw new NotFoundError('Not Found'+error.response?.data as string + ' with token '+token);
      }
      return Promise.reject(error);
    },
  );

  return client;
};

// 3. Export a typed map of pre-initialized clients
export const apiClients: Record<ServiceName, AxiosInstance> = {
  booking: createAxiosClient(BASE_URLS.booking),
};
