import { pino } from 'pino'
import { env } from './env'

const isDev = env.NODE_ENV !== 'production'

export const createLogger = (prefix?: string) => {
  const logger = pino({
    transport: isDev
      ? { target: 'pino-pretty' }
      : undefined,
    msgPrefix: prefix ? `[${prefix}] ` : undefined,
    level: env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  })

  return {
    debug: (obj: unknown, message?: string, ...args: unknown[]) => {
      logger.debug(obj, message, ...args)
    },
    info: (obj: unknown, message?: string, ...args: unknown[]) => {
      logger.info(obj, message, ...args)
    },
    warn: (obj: unknown, message?: string, ...args: unknown[]) => {
      logger.warn(obj, message, ...args)
    },
    error: (obj: unknown, message?: string, ...args: unknown[]) => {
      logger.error(obj, message, ...args)
    },
  }
}

export const Logger = createLogger()
