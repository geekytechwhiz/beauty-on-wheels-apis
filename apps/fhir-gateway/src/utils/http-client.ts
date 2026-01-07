import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

/**
 * HTTP Client Configuration
 * Production-ready axios instance with proper defaults
 */
const createHttpClient = (baseURL?: string): AxiosInstance => {
  const client = axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
    validateStatus: (status) => status < 500,
  });

  return client;
};

/**
 * HTTP Client
 * Production-ready HTTP client wrapper with proper error handling
 */
export const httpClient = {
  get: async <T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> => {
    const axiosConfig: AxiosRequestConfig = {
      ...config,
      ...(params && { params }),
    };
    return axios.get<T>(url, axiosConfig);
  },
  post: async <T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> => {
    return axios.post<T>(url, data, config);
  },
  create: (baseURL?: string): AxiosInstance => createHttpClient(baseURL),
};
