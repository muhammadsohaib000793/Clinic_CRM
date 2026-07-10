// Tiny structured logger. Never log secret values.
const ts = () => new Date().toISOString();

function fmt(level, scope, msg, extra) {
  const base = `[${ts()}] ${level.toUpperCase()} (${scope}) ${msg}`;
  if (extra !== undefined) {
    try {
      return `${base} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
    } catch {
      return base;
    }
  }
  return base;
}

export function createLogger(scope = 'app') {
  return {
    info: (msg, extra) => console.log(fmt('info', scope, msg, extra)),
    warn: (msg, extra) => console.warn(fmt('warn', scope, msg, extra)),
    error: (msg, extra) => console.error(fmt('error', scope, msg, extra)),
    debug: (msg, extra) => {
      if (process.env.NODE_ENV === 'development') console.log(fmt('debug', scope, msg, extra));
    },
  };
}

export const logger = createLogger('app');
