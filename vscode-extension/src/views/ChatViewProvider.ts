/**
 * Chat View Provider
 */

import * as vscode from 'vscode';
import type { CoobeeClient } from '../client/CoobeeClient';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: CoobeeClient
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlContent();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'chat') {
        try {
          const response = await this.client.chat('default', message.text);
          webviewView.webview.postMessage({ type: 'response', content: response.content });
        } catch (err) {
          webviewView.webview.postMessage({ type: 'error', error: String(err) });
        }
      }
    });
  }

  private getHtmlContent(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { padding: 10px; font-family: var(--vscode-font-family); }
    #chat-container { display: flex; flex-direction: column; height: 100%; }
    #messages { flex: 1; overflow-y: auto; margin-bottom: 10px; }
    .message { margin-bottom: 10px; padding: 8px; border-radius: 4px; }
    .user { background: var(--vscode-input-background); }
    .assistant { background: var(--vscode-editor-background); }
    #input-container { display: flex; gap: 5px; }
    input { flex: 1; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; }
  </style>
</head>
<body>
  <div id="chat-container">
    <div id="messages"></div>
    <div id="input-container">
      <input type="text" id="chat-input" placeholder="输入消息..." />
      <button onclick="sendMessage()">发送</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messagesDiv = document.getElementById('messages');
    const inputField = document.getElementById('chat-input');

    function sendMessage() {
      const text = inputField.value.trim();
      if (!text) return;

      addMessage('user', text);
      inputField.value = '';

      vscode.postMessage({ type: 'chat', text });
    }

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = content;
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'response') {
        addMessage('assistant', message.content);
      } else if (message.type === 'error') {
        addMessage('assistant', 'Error: ' + message.error);
      }
    });

    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  </script>
</body>
</html>
    `;
  }
}
