/**
 * StatusBarManager - 状态栏管理器
 */

import * as vscode from 'vscode';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'coobee.showStatus';
    this.setConnected(false);
  }

  /**
   * 设置连接状态
   */
  setConnected(connected: boolean): void {
    if (connected) {
      this.statusBarItem.text = '$(check) Coobee AI';
      this.statusBarItem.tooltip = 'Connected to Coobee AI';
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.text = '$(x) Coobee AI';
      this.statusBarItem.tooltip = 'Not connected to Coobee AI';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
  }

  /**
   * 显示状态栏
   */
  show(): void {
    this.statusBarItem.show();
  }

  /**
   * 隐藏状态栏
   */
  hide(): void {
    this.statusBarItem.hide();
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}
