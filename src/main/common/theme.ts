import { nativeTheme } from 'electron'

import { log } from './logger'
import { ThemeMode } from './types'

export class ThemeManager {
  public setTheme(theme: ThemeMode): void {
    try {
      log.info('Setting theme to', theme)

      const validThemes: ThemeMode[] = ['light', 'dark', 'auto']
      if (!validThemes.includes(theme)) {
        theme = 'light'
      }

      if (theme === 'auto') {
        nativeTheme.themeSource = 'system'
      } else {
        nativeTheme.themeSource = theme
      }
    } catch (error) {
      log.error('Failed to set theme', error)
    }
  }

  public getTheme(): ThemeMode {
    log.info('Getting theme')
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
}

const themeManager = new ThemeManager()
export default themeManager
