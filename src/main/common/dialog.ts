import { dialog, Notification } from 'electron'

import { log } from './logger'

export class DialogManager {
  async showInfo(title: string, message: string, detail?: string): Promise<void> {
    try {
      await dialog.showMessageBox({
        type: 'info',
        title,
        message,
        detail,
        buttons: ['确定']
      })
    } catch (error) {
      log.error('显示信息对话框失败:', error)
    }
  }

  async showError(title: string, message: string, detail?: string): Promise<void> {
    try {
      await dialog.showMessageBox({
        type: 'error',
        title,
        message,
        detail,
        buttons: ['确定']
      })
    } catch (error) {
      log.error('显示错误对话框失败:', error)
    }
  }

  async showWarning(title: string, message: string, detail?: string): Promise<void> {
    try {
      await dialog.showMessageBox({
        type: 'warning',
        title,
        message,
        detail,
        buttons: ['确定']
      })
    } catch (error) {
      log.error('显示警告对话框失败:', error)
    }
  }

  async showConfirm(
    title: string,
    message: string,
    detail?: string,
    confirmText: string = '确定',
    cancelText: string = '取消'
  ): Promise<boolean> {
    try {
      const result = await dialog.showMessageBox({
        type: 'question',
        title,
        message,
        detail,
        buttons: [cancelText, confirmText],
        defaultId: 1,
        cancelId: 0
      })

      return result.response === 1
    } catch (error) {
      log.error('显示确认对话框失败:', error)
      return false
    }
  }

  async showChoice(
    title: string,
    message: string,
    choices: string[],
    detail?: string
  ): Promise<number> {
    try {
      const result = await dialog.showMessageBox({
        type: 'question',
        title,
        message,
        detail,
        buttons: choices,
        defaultId: 0,
        cancelId: 0
      })

      return result.response
    } catch (error) {
      log.error('显示选择对话框失败:', error)
      return 0
    }
  }

  showErrorBox(title: string, content: string): void {
    try {
      dialog.showErrorBox(title, content)
    } catch (error) {
      log.error('显示错误框失败:', error)
    }
  }

  async showSimpleMessage(
    message: string,
    type: 'info' | 'warning' | 'error' = 'info'
  ): Promise<void> {
    try {
      await dialog.showMessageBox({
        type,
        message,
        buttons: ['确定']
      })
    } catch (error) {
      log.error('显示简单提示失败:', error)
    }
  }

  showNotification(
    title: string,
    body: string,
    options?: {
      icon?: string
      silent?: boolean
      urgency?: 'normal' | 'critical' | 'low'
    }
  ): void {
    try {
      if (!Notification.isSupported()) {
        log.warn('系统不支持通知功能')
        return
      }

      const notification = new Notification({
        title,
        body,
        icon: options?.icon,
        silent: options?.silent || false,
        urgency: options?.urgency || 'normal'
      })

      notification.show()

      notification.on('click', () => {
        log.info('用户点击了通知')
      })
    } catch (error) {
      log.error('显示系统通知失败:', error)
    }
  }

  async showSuccess(message: string): Promise<void> {
    try {
      await dialog.showMessageBox({
        type: 'info',
        title: '成功',
        message,
        buttons: ['确定']
      })
    } catch (error) {
      log.error('显示成功提示失败:', error)
    }
  }

  async selectFiles(
    title: string = '选择文件',
    filters?: { name: string; extensions: string[] }[],
    multiSelect: boolean = false
  ): Promise<string[]> {
    try {
      const properties = ['openFile']
      if (multiSelect) {
        properties.push('multiSelections')
      }

      const result = await dialog.showOpenDialog({
        title,
        filters: filters || [{ name: '所有文件', extensions: ['*'] }],
        properties: properties as any
      })

      return result.canceled ? [] : result.filePaths
    } catch (error) {
      log.error('选择文件失败:', error)
      return []
    }
  }

  async selectFolder(title: string = '选择文件夹'): Promise<string | null> {
    try {
      const result = await dialog.showOpenDialog({
        title,
        properties: ['openDirectory'] as any
      })

      return result.canceled ? null : result.filePaths[0]
    } catch (error) {
      log.error('选择文件夹失败:', error)
      return null
    }
  }

  async saveFile(
    title: string = '保存文件',
    defaultPath?: string,
    filters?: { name: string; extensions: string[] }[]
  ): Promise<string | null> {
    try {
      const result = await dialog.showSaveDialog({
        title,
        defaultPath,
        filters: filters || [{ name: '所有文件', extensions: ['*'] }]
      })

      return result.canceled ? null : result.filePath
    } catch (error) {
      log.error('保存文件失败:', error)
      return null
    }
  }
}

export const dialogManager = new DialogManager()
export default dialogManager
