import type { LogLevelName } from '../config/config.js';

export const ENTRY_LEVEL_FLOOR: Record<LogLevelName, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export function passesLevelFilter(level: LogLevelName, configFloor: number): boolean {
  return ENTRY_LEVEL_FLOOR[level] >= configFloor;
}

export function passesSampling(
  level: LogLevelName,
  sampling: { info: number; debug: number }
): boolean {
  if (level === 'ERROR' || level === 'WARN') return true;
  if (level === 'INFO') return Math.random() < sampling.info;
  if (level === 'DEBUG') return Math.random() < sampling.debug;
  return false;
}
