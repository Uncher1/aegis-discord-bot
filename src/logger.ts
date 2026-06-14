const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const currentLevel = (): number => {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
  return LEVELS[raw] ?? LEVELS.info;
};

function ts(): string {
  return new Date().toISOString();
}

function log(level: Level, message: string, meta?: unknown): void {
  if (LEVELS[level] < currentLevel()) return;
  const line = `[${ts()}] [${level.toUpperCase()}] ${message}`;
  const extra = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
  if (level === 'error') console.error(line + extra);
  else if (level === 'warn') console.warn(line + extra);
  else console.log(line + extra);
}

export const logger = {
  debug: (msg: string, meta?: unknown) => log('debug', msg, meta),
  info: (msg: string, meta?: unknown) => log('info', msg, meta),
  warn: (msg: string, meta?: unknown) => log('warn', msg, meta),
  error: (msg: string, meta?: unknown) => log('error', msg, meta),
};
