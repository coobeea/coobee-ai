/**
 * ChatPanel - 聊天面板
 */

import * as vscode from 'vscode';
import type { CoobeeClient } from '../client/CoobeeClient';

export class ChatPanel {
  public static currentPanel: ChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, private client: CoobeeClient) {
    this.panel = panel;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.html = this.getHtmlContent();

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'sendMessage':
            await this.handleSendMessage(message.text);
            break;
        }
      },
      null,
      this.disposables
    );
  }

  /**
   * 创建或显示面板
   */
  public static createOrShow(extensionUri: vscode.Uri, client: CoobeeClient) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel('coobeeChat', 'Coobee AI Chat', column || vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true
    });

    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, client);
  }

  /**
   * 处理发送消息
   */
  private async handleSendMessage(text: string) {
    try {
      this.panel.webview.postMessage({
        type: 'userMessage',
        text
      });

      const response = await this.client.chat('default', text);

      this.panel.webview.postMessage({
        type: 'agentResponse',
        text: response.content
      });
    } catch (err) {
      this.panel.webview.postMessage({
        type: 'error',
        text: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * 获取 HTML 内容
   */
  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Coobee AI Chat</title>
  <style>
    body {
      padding: 10px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    #messages {
      height: calc(100vh - 100px);
      overflow-y: auto;
      margin-bottom: 10px;
      padding: 10px;
      border: 1px solid var(--vscode-panel-border);
    }
    .message {
      margin: 10px 0;
      padding: 8px;
      border-radius: 4px;
    }
    .user {
      background-color: var(--vscode-input-background);
    }
    .agent {
      background-color: var(--vscode-editor-inactiveSelectionBackground);
    }
    .error {
      color: var(--vscode-errorForeground);
    }
    #input-area {
      display: flex;
      gap: 5px;
    }
    #message-input {
      flex: 1;
      padding: 8px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    button {
      padding: 8px 16px;
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      cursor: pointer;
    }
    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div id="messages"></div>
  <div id="input-area">
    <input type="text" id="message-input" placeholder="输入消息..." />
    <button id="send-button">发送</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messagesDiv = document.getElementById('messages');
    const input = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    function addMessage(text, className) {
      const div = document.createElement('div');
      div.className = 'message ' + className;
      div.textContent = text;
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    sendButton.onclick = () => {
      const text = input.value.trim();
      if (text) {
        vscode.postMessage({ type: 'sendMessage', text });
        input.value = '';
      }
    };

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendButton.click();
      }
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'userMessage':
          addMessage('你: ' + message.text, 'user');
          break;
        case 'agentResponse':
          addMessage('Agent: ' + message.text, 'agent');
          break;
        case 'error':
          addMessage('错误: ' + message.text, 'error');
          break;
      }
    });
  </script>
</body>
</html>`;
  }

  /**
   * 释放资源
   */
  public dispose() {
    ChatPanel.currentPanel = undefined;

    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
