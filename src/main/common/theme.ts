import { nativeTheme } from 'electron'

import { log } from './logger'

type ThemeMode = 'light' | 'dark' | 'auto'

class ThemeManager {
  setTheme(theme: ThemeMode) {
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

  getTheme(): ThemeMode {
    log.info('Getting theme')
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
}

const themeManager = new ThemeManager()
export default themeManager
export { ThemeManager, type ThemeMode }
