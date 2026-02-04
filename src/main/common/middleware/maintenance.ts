import { log } from '../logger'
import { stateManager } from '../state'
import { Middleware } from './types'

export const maintenanceMiddleware: Middleware = {
  name: 'maintenance',
  priority: 3,
  async execute(context, next) {
    if (stateManager.getMaintenanceModeState()) {
      log.warn(`[Maintenance] Operation blocked: ${context.method}`)
      return {
        success: false,
        error: new Error('System is in maintenance mode')
      }
    }

    return await next()
  }
}
