import { LambdaRequest, ValidationError } from '@api-hub/utils';

import { ServiceVisitsService, getServiceVisitsService } from '../services/service-visits.service';

export class ServiceVisitsController {
  constructor(private readonly service: ServiceVisitsService = getServiceVisitsService()) {}

  create(request: LambdaRequest) {
    return this.service.create(request, vendorId(request));
  }

  list(request: LambdaRequest) {
    const limit = numberParam(request.query?.limit ?? request.params?.limit, 20, 50);
    const cursor = text(request.query?.cursor ?? request.params?.cursor);
    const status = text(request.query?.status ?? request.params?.status);
    return this.service.list(request, vendorId(request), { limit, cursor, status });
  }

  get(request: LambdaRequest) {
    return this.service.get(request, vendorId(request), visitId(request));
  }

  update(request: LambdaRequest) {
    return this.service.update(request, vendorId(request), visitId(request));
  }

  activate(request: LambdaRequest) {
    return this.service.activate(request, vendorId(request), visitId(request));
  }

  pause(request: LambdaRequest) {
    return this.service.pause(request, vendorId(request), visitId(request));
  }

  archive(request: LambdaRequest) {
    return this.service.archive(request, vendorId(request), visitId(request));
  }
}

function vendorId(request: LambdaRequest): string {
  const value = request.pathParameters?.vendorId ?? request.params?.vendorId;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value)) {
    throw new ValidationError('vendorId is invalid');
  }
  return value;
}

function visitId(request: LambdaRequest): string {
  const value = request.pathParameters?.visitId ?? request.params?.visitId;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value)) {
    throw new ValidationError('visitId is invalid');
  }
  return value;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberParam(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ValidationError(`limit must be a whole number from 1 to ${max}`);
  }
  return parsed;
}

let controller: ServiceVisitsController | undefined;

export function getServiceVisitsController(): ServiceVisitsController {
  if (!controller) {
    controller = new ServiceVisitsController();
  }
  return controller;
}
