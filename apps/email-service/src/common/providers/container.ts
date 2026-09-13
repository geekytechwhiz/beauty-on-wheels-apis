import { environment } from '../config/environment.js';
import { IEmailProvider } from './IEmailProvider.js';
import { ITemplateRegistryProvider } from './ITemplateRegistryProvider.js';
import { IStorageProvider } from './IStorageProvider.js';
import { IQueueProvider } from './IQueueProvider.js';
import { IOrchestratorProvider } from './IOrchestratorProvider.js';
import { ICampaignRepository } from './ICampaignRepository.js';
import { IRecipientRepository } from './IRecipientRepository.js';

import { SesEmailProvider } from './impl/SesEmailProvider.js';
import { SesTemplateRegistryProvider } from './impl/SesTemplateRegistryProvider.js';
import { S3StorageProvider } from './impl/S3StorageProvider.js';
import { SqsQueueProvider } from './impl/SqsQueueProvider.js';
import { SfnOrchestratorProvider } from './impl/SfnOrchestratorProvider.js';
import { DynamoDbCampaignRepository } from './impl/DynamoDbCampaignRepository.js';
import { DynamoDbRecipientRepository } from './impl/DynamoDbRecipientRepository.js';

class DependencyContainer {
  private instances: Map<string, any> = new Map();

  constructor() {
    this.registerProviders();
  }

  private registerProviders() {
    const region = environment.awsRegion;

    const emailProvider = new SesEmailProvider(region);
    const templateRegistryProvider = new SesTemplateRegistryProvider(region);
    const storageProvider = new S3StorageProvider(region);
    const queueProvider = new SqsQueueProvider(region);
    const orchestratorProvider = new SfnOrchestratorProvider(region);

    const campaignRepository = new DynamoDbCampaignRepository(
      region,
      environment.campaignsTable,
      environment.campaignBatchesTable,
      environment.recipientTrackingTable,
    );

    const recipientRepository = new DynamoDbRecipientRepository(
      region,
      environment.registryTable,
      environment.recipientsTable,
    );

    this.instances.set('IEmailProvider', emailProvider);
    this.instances.set('ITemplateRegistryProvider', templateRegistryProvider);
    this.instances.set('IStorageProvider', storageProvider);
    this.instances.set('IQueueProvider', queueProvider);
    this.instances.set('IOrchestratorProvider', orchestratorProvider);
    this.instances.set('ICampaignRepository', campaignRepository);
    this.instances.set('IRecipientRepository', recipientRepository);
  }

  public get<T>(key: string): T {
    const instance = this.instances.get(key);
    if (!instance) {
      throw new Error(`Dependency for key ${key} has not been registered in container.`);
    }
    return instance as T;
  }

  // Helper method to override dependency for tests (Mocking)
  public set<T>(key: string, instance: T): void {
    this.instances.set(key, instance);
  }
}

export const container = new DependencyContainer();

export const getEmailProvider = () => container.get<IEmailProvider>('IEmailProvider');
export const getTemplateRegistryProvider = () =>
  container.get<ITemplateRegistryProvider>('ITemplateRegistryProvider');
export const getStorageProvider = () => container.get<IStorageProvider>('IStorageProvider');
export const getQueueProvider = () => container.get<IQueueProvider>('IQueueProvider');
export const getOrchestratorProvider = () =>
  container.get<IOrchestratorProvider>('IOrchestratorProvider');
export const getCampaignRepository = () =>
  container.get<ICampaignRepository>('ICampaignRepository');
export const getRecipientRepository = () =>
  container.get<IRecipientRepository>('IRecipientRepository');
