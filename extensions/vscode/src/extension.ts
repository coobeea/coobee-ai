/**
 * Coobee AI VS Code Extension
 */

import * as vscode from 'vscode';
import { CoobeeClient } from './client/CoobeeClient';
import { StatusBarManager } from './ui/StatusBarManager';
import { ChatPanel } from './ui/ChatPanel';

let client: CoobeeClient;
let statusBar: StatusBarManager;

/**
 * 插件激活
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Coobee AI extension is now active');

  const config = vscode.workspace.getConfiguration('coobee');
  const serverUrl = config.get<string>('serverUrl') || 'http://localhost:13888';
  const apiKey = config.get<string>('apiKey') || '';

  client = new CoobeeClient(serverUrl, apiKey);
  statusBar = new StatusBarManager();

  statusBar.show();

  context.subscriptions.push(
    vscode.commands.registerCommand('coobee.connect', async () => {
      try {
        await client.connect();
        vscode.window.showInformationMessage('✅ 已连接到 Coobee AI 服务器');
        statusBar.setConnected(true);
      } catch (err) {
        vscode.window.showErrorMessage(`连接失败: ${err instanceof Error ? err.message : String(err)}`);
        statusBar.setConnected(false);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('coobee.chat', () => {
      ChatPanel.createOrShow(context.extensionUri, client);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('coobee.submitTask', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('请先打开一个文件');
        return;
      }

      const selection = editor.selection;
      const text = editor.document.getText(selection);

      const taskDescription = await vscode.window.showInputBox({
        prompt: '请输入任务描述',
        value: text ? `处理选中的代码：\n${text}` : ''
      });

      if (!taskDescription) return;

      try {
        const task = await client.submitTask(taskDescription);
        vscode.window.showInformationMessage(`✅ 任务已提交: ${task.id}`);
      } catch (err) {
        vscode.window.showErrorMessage(`提交失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('coobee.showStatus', async () => {
      try {
        const status = await client.getStatus();
        vscode.window.showInformationMessage(`Coobee AI 状态: ${JSON.stringify(status)}`);
      } catch (err) {
        vscode.window.showErrorMessage(`获取状态失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  if (config.get<boolean>('autoConnect')) {
    client.connect().catch(() => {
      statusBar.setConnected(false);
    });
  }
}

/**
 * 插件停用
 */
export function deactivate() {
  statusBar?.dispose();
}
