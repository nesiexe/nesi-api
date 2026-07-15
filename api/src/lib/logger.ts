import { pino } from 'pino'

export const createLogger = (prefix?: string) => {
  const logger = pino({
    transport: true
      ? {
          target: 'pino-pretty',
        }
      : undefined,
    msgPrefix: prefix ? `[${prefix}] ` : undefined,
    level: true ? 'debug' : 'info',
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
