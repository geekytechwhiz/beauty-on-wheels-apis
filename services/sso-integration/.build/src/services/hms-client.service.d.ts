/**
 * HMS Client Registry Service
 * Manages HMS client credentials and launch configuration
 * Uses in-memory storage for local dev (serverless offline) when AWS credentials unavailable
 */
import { HMSClient } from '../types';
export declare class HMSClientService {
    private useDynamo;
    getClient(clientId: string): Promise<HMSClient | null>;
    getClientByHmsId(hmsId: string): Promise<HMSClient | null>;
    validateClient(clientId: string, clientSecret?: string): Promise<HMSClient | null>;
    registerClient(hmsClient: Omit<HMSClient, 'createdAt' | 'active'>): Promise<HMSClient>;
}
