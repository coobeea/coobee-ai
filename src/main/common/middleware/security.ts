import { log } from '../logger'
import { Middleware } from './types'

export const securityMiddleware: Middleware = {
  name: 'security',
  priority: 2,
  async execute(context, next) {
    log.debug(`[Security] Validating ${context.method}`)

    const result = await next()

    return result
  }
}
