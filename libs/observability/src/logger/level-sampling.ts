export function shouldSample(level: 'DEBUG' | 'INFO') {
  if (level === 'INFO') {
    return Math.random() < Number(process.env.LOG_SAMPLE_INFO ?? 0.1);
  }

  if (level === 'DEBUG') {
    return Math.random() < Number(process.env.LOG_SAMPLE_DEBUG ?? 0.01);
  }

  return true;
}