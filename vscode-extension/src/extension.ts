/**
 * VS Code Extension Entry Point
 */

import * as vscode from 'vscode';
import { ChatViewProvider } from './views/ChatViewProvider';
import { AgentsViewProvider } from './views/AgentsViewProvider';
import { CoobeeClient } from './client/CoobeeClient';

export function activate(context: vscode.ExtensionContext) {
  console.log('Coobee AI extension activated');

  const config = vscode.workspace.getConfiguration('coobee');
  const apiUrl = config.get<string>('apiUrl') || 'http://localhost:13000';
  const apiKey = config.get<string>('apiKey') || '';

  const client = new CoobeeClient({ apiUrl, apiKey });

  const chatProvider = new ChatViewProvider(context.extensionUri, client);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('coobee-chat', chatProvider));

  const agentsProvider = new AgentsViewProvider(context.extensionUri, client);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('coobee-agents', agentsProvider));

  const chatCommand = vscode.commands.registerCommand('coobee.chat', () => {
    vscode.commands.executeCommand('workbench.view.extension.coobee-sidebar');
  });

  const reviewCommand = vscode.commands.registerCommand('coobee.review', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor');
      return;
    }

    const selection = editor.selection;
    const text = editor.document.getText(selection);

    if (!text) {
      vscode.window.showInformationMessage('No code selected');
      return;
    }

    vscode.window.showInformationMessage(`Reviewing ${text.length} characters...`);

    try {
      const response = await client.chat('code-reviewer', `请审查这段代码：\n\n${text}`);
      vscode.window.showInformationMessage(`Review: ${response.content.slice(0, 100)}...`);
    } catch (err) {
      vscode.window.showErrorMessage(`Review failed: ${err}`);
    }
  });

  const explainCommand = vscode.commands.registerCommand('coobee.explain', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    const text = editor.document.getText(selection);

    if (!text) return;

    try {
      const response = await client.chat('default', `请解释这段代码：\n\n${text}`);
      vscode.window.showInformationMessage(response.content);
    } catch (err) {
      vscode.window.showErrorMessage(`Explain failed: ${err}`);
    }
  });

  context.subscriptions.push(chatCommand, reviewCommand, explainCommand);
}

export function deactivate() {
  console.log('Coobee AI extension deactivated');
}
