import { createChildLogger, createLogger } from '@api-hub/logger';
import { getTruTechAdapter } from '../adapters/trutech.adapter.ts';
import { getUserServiceClient } from '../clients/user.client';
import { CognitoService } from '../services/cognito.service';
import { getPatientEventPublisher } from '../services/patient-event-publisher.service';
import { getSSOConfig } from '../config/sso-config';
import { getServiceTokenService } from '../services/service-token.service';
import { getTruTechClient } from '../clients/tru-tech.clients.js';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export class BaseService {

  protected readonly logger;
  protected readonly truTechAdapter;
  protected readonly userServiceClient;
  protected readonly cognitoService;
  protected readonly truTechClient;
  protected readonly patientEventPublisher;
  protected readonly config;
  protected readonly serviceTokenService;

  constructor(component: string) {

    this.logger = createChildLogger(baseLogger, {
      component
    });

    this.truTechAdapter = getTruTechAdapter();
    this.userServiceClient = getUserServiceClient();
    this.truTechClient = getTruTechClient();
    this.cognitoService = new CognitoService();
    this.patientEventPublisher = getPatientEventPublisher();
    this.config = getSSOConfig();
    this.serviceTokenService = getServiceTokenService();
  }

}