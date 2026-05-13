import { getConfig } from '../config/config';

export function shouldSample(level: 'DEBUG' | 'INFO') {
  const cfg = getConfig();
  if (level === 'INFO') {
    return Math.random() < cfg.sampling.info;
  }

  if (level === 'DEBUG') {
    return Math.random() < cfg.sampling.debug;
  }

  return true;
}