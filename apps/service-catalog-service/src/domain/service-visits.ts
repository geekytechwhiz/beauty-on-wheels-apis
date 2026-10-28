import { ValidationError } from '@api-hub/utils';

/** Wire values are camelCase. Day codes stay the existing short tokens. */
export const DELIVERY_MODEL = {
  COMMUNITY: 'community',
  DOORSTEP: 'doorstep',
} as const;

export type DeliveryModel = (typeof DELIVERY_MODEL)[keyof typeof DELIVERY_MODEL];

export const VISIT_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
} as const;

export type VisitStatus = (typeof VISIT_STATUS)[keyof typeof VISIT_STATUS];

export const LOCATION_TYPE = {
  COMMUNITY: 'community',
  SERVICE_AREA: 'serviceArea',
} as const;

export type LocationType = (typeof LOCATION_TYPE)[keyof typeof LOCATION_TYPE];

export const WINDOW_LABEL = {
  EARLY_MORNING: 'earlyMorning',
  MORNING: 'morning',
  AFTERNOON: 'afternoon',
  EVENING: 'evening',
  NIGHT: 'night',
  WEEKEND: 'weekend',
  CUSTOM: 'custom',
} as const;

export type WindowLabel = (typeof WINDOW_LABEL)[keyof typeof WINDOW_LABEL];

/** Wire values stay camelCase. Request aliases such as VENDOR_SUPPLIED are normalized before they are stored. */
export const WATER_SOURCE = {
  VENDOR_SUPPLIED: 'vendorSupplied',
  COMMUNITY_SUPPLIED: 'communitySupplied',
  WATERLESS: 'waterless',
} as const;

export type WaterSource = (typeof WATER_SOURCE)[keyof typeof WATER_SOURCE];

export const DAY_OF_WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type DayOfWeek = (typeof DAY_OF_WEEK)[number];

const DAY_INDEX: Record<DayOfWeek, number> = {
  MON: 0,
  TUE: 1,
  WED: 2,
  THU: 3,
  FRI: 4,
  SAT: 5,
  SUN: 6,
};

export const MAX_VISIT_CAPACITY = 100;
export const MAX_WINDOW_MINUTES = 24 * 60;
export const MAX_STAFF_COUNT = 100;
export const MAX_WATER_LITERS = 100_000;
/** A booking may cover at most this many shared capacity blocks. */
export const MAX_COVERED_BLOCKS = 23;

export interface WindowCapacity {
  staffCount: number;
}

export interface WindowWater {
  source: WaterSource;
  /** Present only when the vendor supplies the water. */
  capacityLiters?: number;
}

export interface WindowResources {
  water: WindowWater;
  equipment: {
    providedByVendor: boolean;
  };
}

export interface ServiceVisitWindow {
  windowId: string;
  label: WindowLabel;
  daysOfWeek: DayOfWeek[];
  startTime: string;
  endTime: string;
  endDayOffset: 0 | 1;
  /**
   * Legacy concurrent booking limit. Kept when a saved window already has it.
   * Staff count is not copied into this field.
   */
  maxConcurrentBookings?: number;
  bufferMinutes?: number;
  capacity?: WindowCapacity;
  resources?: WindowResources;
}

export interface VisitLocation {
  type: LocationType;
  communityId?: string;
  serviceAreaId?: string;
  branchId?: string;
}

export interface VisitServiceRef {
  serviceId: string;
  durationMinutes: number;
  /** Liters one booking uses. Absent when the service does not declare water use. */
  waterLiters?: number;
  /** Absent when the service does not declare that it needs water. */
  requiresWater?: boolean;
  /** Absent when the service does not declare that it needs vendor equipment. */
  requiresVendorEquipment?: boolean;
}

export interface ServiceVisitRecord {
  visitId: string;
  vendorId: string;
  ownerUserId: string;
  name: string;
  deliveryModel: DeliveryModel;
  location: VisitLocation;
  timezone: string;
  windows: ServiceVisitWindow[];
  serviceIds: string[];
  services: VisitServiceRef[];
  staffIds: string[];
  effectiveFrom: string;
  effectiveUntil?: string | null;
  status: VisitStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface MinuteSpan {
  start: number;
  end: number;
}

const TIME = /^(\d{2}):(\d{2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

export function assertServiceVisitShape(input: {
  name: string;
  deliveryModel: string;
  location: VisitLocation;
  timezone: string;
  windows: ServiceVisitWindow[];
  serviceIds: string[];
  staffIds?: string[];
  effectiveFrom: string;
  effectiveUntil?: string | null;
}, options: { allowLegacyWindows?: boolean } = {}): void {
  if (!input.name.trim() || input.name.trim().length > 120) {
    throw new ValidationError('name must be between 1 and 120 characters');
  }
  if (input.deliveryModel !== DELIVERY_MODEL.COMMUNITY && input.deliveryModel !== DELIVERY_MODEL.DOORSTEP) {
    throw new ValidationError('deliveryModel must be community or doorstep');
  }
  assertLocation(input.deliveryModel, input.location);
  assertTimeZone(input.timezone);
  if (!input.windows.length) {
    throw new ValidationError('At least one visit window is required');
  }
  const windowIds = new Set<string>();
  const allowLegacyWindows = options.allowLegacyWindows ?? true;
  for (const window of input.windows) {
    assertWindow(window, allowLegacyWindows);
    if (windowIds.has(window.windowId)) {
      throw new ValidationError(`Duplicate windowId ${window.windowId}`);
    }
    windowIds.add(window.windowId);
  }
  if (windowsOverlap(input.windows)) {
    throw new ValidationError('Visit windows in this configuration overlap');
  }
  assertIdList(input.serviceIds, 'serviceIds');
  if (input.staffIds) {
    assertIdList(input.staffIds, 'staffIds', true);
  }
  if (!isDate(input.effectiveFrom)) {
    throw new ValidationError('effectiveFrom must be YYYY-MM-DD');
  }
  if (input.effectiveUntil) {
    if (!isDate(input.effectiveUntil)) {
      throw new ValidationError('effectiveUntil must be YYYY-MM-DD');
    }
    if (input.effectiveUntil < input.effectiveFrom) {
      throw new ValidationError('effectiveUntil must be on or after effectiveFrom');
    }
  }
}

export function assertServicesFit(
  windows: ServiceVisitWindow[],
  services: VisitServiceRef[],
): void {
  if (!services.length) {
    throw new ValidationError('At least one service is required');
  }
  const step = sharedStep(services.map((service) => service.durationMinutes));
  for (const service of services) {
    const fitsDuration = windows.some((window) => serviceFits(window, service.durationMinutes));
    if (!fitsDuration) {
      throw new ValidationError(
        `Service ${service.serviceId} does not fit inside any visit window`,
      );
    }
    const fitsResources = windows.some((window) => windowSupportsService(window, service));
    if (!fitsResources) {
      throw new ValidationError(
        `Service ${service.serviceId} is not compatible with the water or equipment in any visit window`,
      );
    }
  }
  for (const window of windows) {
    const fitting = services.filter((service) => windowSupportsService(window, service));
    if (!fitting.length) {
      continue;
    }
    const windowStep = sharedStep(fitting.map((service) => service.durationMinutes + (window.bufferMinutes ?? 0)));
    const longest = Math.max(...fitting.map((service) => service.durationMinutes + (window.bufferMinutes ?? 0)));
    if (longest / windowStep > MAX_COVERED_BLOCKS) {
      throw new ValidationError(
        'These service durations cannot share capacity in this window. Align the durations so one booking covers at most 23 capacity blocks.',
      );
    }
  }
  if (step < 1) {
    throw new ValidationError('Service durations must be positive');
  }
}

export function serviceFits(window: ServiceVisitWindow, durationMinutes: number): boolean {
  const length = windowLength(window);
  return durationMinutes + (window.bufferMinutes ?? 0) <= length;
}

/** Duration fit plus water and equipment. Legacy windows with no resources stay duration-only. */
export function windowSupportsService(window: ServiceVisitWindow, service: VisitServiceRef): boolean {
  return serviceFits(window, service.durationMinutes) && resourcesSupport(window, service);
}

export function isLegacyWindow(window: ServiceVisitWindow): boolean {
  return window.capacity === undefined
    && window.resources === undefined
    && window.maxConcurrentBookings !== undefined;
}

export function configurationsOverlap(left: ServiceVisitRecord, right: ServiceVisitRecord): boolean {
  if (left.visitId === right.visitId) {
    return false;
  }
  if (locationKey(left.location) !== locationKey(right.location)) {
    return false;
  }
  if (!staffShares(left.staffIds, right.staffIds)) {
    return false;
  }
  return spansOverlapAny(weeklySpans(left.windows), weeklySpans(right.windows));
}

export function weeklySpans(windows: ServiceVisitWindow[]): MinuteSpan[] {
  return windows.flatMap((window) => {
    const length = windowLength(window);
    return window.daysOfWeek.map((day) => {
      const start = DAY_INDEX[day] * 1440 + minutes(window.startTime);
      return { start, end: start + length };
    });
  });
}

export function transitionChange(
  previous: VisitStatus | undefined,
  next: VisitStatus,
): 'created' | 'updated' | 'activated' | 'paused' | 'archived' {
  if (!previous) {
    return next === VISIT_STATUS.ACTIVE ? 'activated' : 'created';
  }
  if (previous === next) {
    return 'updated';
  }
  if (next === VISIT_STATUS.ACTIVE) {
    return 'activated';
  }
  if (next === VISIT_STATUS.PAUSED) {
    return 'paused';
  }
  if (next === VISIT_STATUS.ARCHIVED) {
    return 'archived';
  }
  return 'updated';
}

export function canTransition(from: VisitStatus, to: VisitStatus): boolean {
  if (from === to) {
    return false;
  }
  if (to === VISIT_STATUS.ARCHIVED) {
    return from !== VISIT_STATUS.ARCHIVED;
  }
  if (from === VISIT_STATUS.DRAFT && to === VISIT_STATUS.ACTIVE) {
    return true;
  }
  if (from === VISIT_STATUS.ACTIVE && to === VISIT_STATUS.PAUSED) {
    return true;
  }
  if (from === VISIT_STATUS.PAUSED && to === VISIT_STATUS.ACTIVE) {
    return true;
  }
  return false;
}

export function locationKey(location: VisitLocation): string {
  if (location.type === LOCATION_TYPE.COMMUNITY) {
    return `community:${location.communityId}`;
  }
  return `serviceArea:${location.serviceAreaId}`;
}

export function branchKey(location: VisitLocation): string {
  if (location.branchId) {
    return location.branchId;
  }
  if (location.type === LOCATION_TYPE.COMMUNITY && location.communityId) {
    return `community_${location.communityId}`;
  }
  return `area_${location.serviceAreaId ?? 'unknown'}`;
}

function assertLocation(deliveryModel: string, location: VisitLocation): void {
  if (deliveryModel === DELIVERY_MODEL.COMMUNITY) {
    if (location.type !== LOCATION_TYPE.COMMUNITY || !isId(location.communityId)) {
      throw new ValidationError('A community visit requires location.type community and communityId');
    }
  } else if (location.type !== LOCATION_TYPE.SERVICE_AREA || !isId(location.serviceAreaId)) {
    throw new ValidationError('A doorstep visit requires location.type serviceArea and serviceAreaId');
  }
  if (location.branchId !== undefined && !isId(location.branchId)) {
    throw new ValidationError('branchId is invalid');
  }
}

function assertWindow(window: ServiceVisitWindow, allowLegacyWindows: boolean): void {
  if (!isId(window.windowId)) {
    throw new ValidationError('windowId is invalid');
  }
  if (!Object.values(WINDOW_LABEL).includes(window.label)) {
    throw new ValidationError('window label is invalid');
  }
  if (!window.daysOfWeek.length) {
    throw new ValidationError('Each window needs at least one day');
  }
  if (new Set(window.daysOfWeek).size !== window.daysOfWeek.length) {
    throw new ValidationError('daysOfWeek contains a duplicate');
  }
  for (const day of window.daysOfWeek) {
    if (!DAY_OF_WEEK.includes(day)) {
      throw new ValidationError('daysOfWeek must use MON through SUN');
    }
  }
  if (!isTime(window.startTime) || !isTime(window.endTime)) {
    throw new ValidationError('Window times must be HH:mm');
  }
  if (window.endDayOffset !== 0 && window.endDayOffset !== 1) {
    throw new ValidationError('endDayOffset must be 0 or 1');
  }
  const length = windowLength(window);
  if (length <= 0 || length > MAX_WINDOW_MINUTES) {
    throw new ValidationError('A visit window must be longer than 0 minutes and at most 24 hours');
  }
  if (
    window.bufferMinutes !== undefined &&
    (!Number.isInteger(window.bufferMinutes) || window.bufferMinutes < 0 || window.bufferMinutes > 240)
  ) {
    throw new ValidationError('bufferMinutes must be a whole number from 0 to 240');
  }
  if (window.maxConcurrentBookings !== undefined && !validConcurrency(window.maxConcurrentBookings)) {
    throw new ValidationError('maxConcurrentBookings must be a whole number from 1 to 100');
  }
  if (isLegacyWindow(window)) {
    if (!allowLegacyWindows) {
      throw new ValidationError('Each visit window requires capacity.staffCount and resources');
    }
    return;
  }
  if (!window.capacity || !validStaffCount(window.capacity.staffCount)) {
    throw new ValidationError('staffCount must be a positive whole number');
  }
  if (!window.resources) {
    throw new ValidationError('Each visit window requires water and equipment');
  }
  assertResources(window.resources);
}

function assertResources(resources: WindowResources): void {
  if (!Object.values(WATER_SOURCE).includes(resources.water.source)) {
    throw new ValidationError('water source must be vendorSupplied, communitySupplied, or waterless');
  }
  if (typeof resources.equipment?.providedByVendor !== 'boolean') {
    throw new ValidationError('equipment.providedByVendor must be true or false');
  }
  const liters = resources.water.capacityLiters;
  if (resources.water.source === WATER_SOURCE.VENDOR_SUPPLIED) {
    if (!validLiters(liters)) {
      throw new ValidationError('capacityLiters must be a positive whole number when water is vendor supplied');
    }
    return;
  }
  if (liters !== undefined) {
    throw new ValidationError('capacityLiters is only allowed when water is vendor supplied');
  }
}

function resourcesSupport(window: ServiceVisitWindow, service: VisitServiceRef): boolean {
  if (!window.resources) {
    return true;
  }
  // An absent service flag is unknown, not confirmation that the alternative is supported.
  if (window.resources.equipment.providedByVendor !== true && service.requiresVendorEquipment !== false) {
    return false;
  }
  if (window.resources.water.source === WATER_SOURCE.WATERLESS) {
    if (service.requiresWater !== false || (service.waterLiters ?? 0) > 0) {
      return false;
    }
  }
  if (
    service.waterLiters !== undefined
    && window.resources.water.source === WATER_SOURCE.VENDOR_SUPPLIED
    && (window.resources.water.capacityLiters ?? 0) < service.waterLiters
  ) {
    return false;
  }
  return true;
}

function validConcurrency(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_VISIT_CAPACITY;
}

function validStaffCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_STAFF_COUNT;
}

function validLiters(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= MAX_WATER_LITERS;
}

function windowLength(window: ServiceVisitWindow): number {
  return minutes(window.endTime) + window.endDayOffset * 1440 - minutes(window.startTime);
}

function windowsOverlap(windows: ServiceVisitWindow[]): boolean {
  const spans = weeklySpans(windows);
  for (let index = 0; index < spans.length; index += 1) {
    for (let other = index + 1; other < spans.length; other += 1) {
      if (spansOverlapAny([spans[index]], [spans[other]])) {
        return true;
      }
    }
  }
  return false;
}

function spansOverlapAny(left: MinuteSpan[], right: MinuteSpan[]): boolean {
  return left.some((span) => right.some((other) => (
    [-10080, 0, 10080].some((shift) => span.start < other.end + shift && other.start + shift < span.end)
  )));
}

function staffShares(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) {
    return true;
  }
  return left.some((id) => right.includes(id));
}

export function sharedStep(durations: number[]): number {
  return durations.reduce((current, duration) => gcd(current, duration));
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function assertIdList(values: string[], label: string, allowEmpty = false): void {
  if (!allowEmpty && values.length === 0) {
    throw new ValidationError(`${label} must include at least one id`);
  }
  if (new Set(values).size !== values.length) {
    throw new ValidationError(`${label} contains a duplicate`);
  }
  for (const value of values) {
    if (!isId(value)) {
      throw new ValidationError(`${label} contains an invalid id`);
    }
  }
}

function assertTimeZone(timeZone: string): void {
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new ValidationError('timezone must be an IANA timezone');
  }
}

function isTime(value: string): boolean {
  const match = TIME.exec(value);
  if (!match) {
    return false;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function isId(value: string | undefined): value is string {
  return typeof value === 'string' && ID.test(value);
}

function minutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}
