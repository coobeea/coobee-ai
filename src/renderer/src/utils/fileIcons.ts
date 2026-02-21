/**
 * 文件图标工具函数
 */

/**
 * 根据文件名返回对应的 Carbon 图标 class
 */
export function getFileIconClass(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'i-carbon-logo-typescript';
    case 'js':
    case 'jsx':
      return 'i-carbon-logo-javascript';
    case 'vue':
      return 'i-carbon-application-web';
    case 'json':
      return 'i-carbon-json';
    case 'md':
      return 'i-carbon-document';
    case 'css':
    case 'scss':
    case 'less':
      return 'i-carbon-color-palette';
    case 'html':
      return 'i-carbon-html';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return 'i-carbon-image';
    case 'yaml':
    case 'yml':
      return 'i-carbon-settings';
    case 'py':
      return 'i-carbon-logo-python';
    case 'java':
      return 'i-carbon-logo-java';
    case 'go':
      return 'i-carbon-code';
    case 'rs':
      return 'i-carbon-code';
    default:
      if (!ext) return 'i-carbon-folder';
      return 'i-carbon-document-blank';
  }
}

/**
 * 根据文件名返回对应的 emoji 图标
 */
export function getFileIconEmoji(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return '📘';
    case 'js':
    case 'jsx':
      return '📙';
    case 'vue':
      return '💚';
    case 'json':
      return '📋';
    case 'md':
      return '📝';
    case 'css':
    case 'scss':
    case 'less':
      return '🎨';
    case 'html':
      return '🌐';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return '🖼️';
    case 'yaml':
    case 'yml':
      return '⚙️';
    case 'py':
      return '🐍';
    case 'java':
      return '☕';
    case 'go':
      return '🐹';
    case 'rs':
      return '🦀';
    default:
      if (!ext) return '📁';
      return '📄';
  }
}
