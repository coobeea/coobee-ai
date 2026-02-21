/**
 * FileReference - Tiptap 文件引用扩展
 *
 * 允许在富文本编辑器中插入文件引用，显示为带图标的小标签。
 * 数据结构：{ path: 完整路径, name: 文件名 }
 */

import { Node, mergeAttributes } from '@tiptap/core';

export interface FileReferenceOptions {
  HTMLAttributes: Record<string, unknown>;
}

export interface FileReferenceAttrs {
  path: string;
  name: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileReference: {
      /**
       * 插入文件引用
       */
      insertFileReference: (attrs: FileReferenceAttrs) => ReturnType;
    };
  }
}

export const FileReference = Node.create<FileReferenceOptions>({
  name: 'fileReference',

  group: 'inline',

  inline: true,

  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {}
    };
  },

  addAttributes() {
    return {
      path: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-path'),
        renderHTML: (attributes) => ({
          'data-path': attributes.path
        })
      },
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-name'),
        renderHTML: (attributes) => ({
          'data-name': attributes.name
        })
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="file-reference"]'
      }
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const icon = getFileIcon(node.attrs.name);

    return [
      'span',
      mergeAttributes(
        {
          'data-type': 'file-reference',
          class: 'file-reference'
        },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      ['span', { class: 'file-reference-icon' }, icon],
      ['span', { class: 'file-reference-name' }, node.attrs.name]
    ];
  },

  addCommands() {
    return {
      insertFileReference:
        (attrs) =>
        ({ chain }) => {
          return chain().insertContent({ type: this.name, attrs }).run();
        }
    };
  }
});

/**
 * 根据文件名返回对应的图标字符
 */
function getFileIcon(name: string): string {
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
    case 'sh':
    case 'bash':
      return '⚡';
    case 'c':
    case 'cpp':
    case 'h':
      return '⚙️';
    default:
      if (!ext) return '📁';
      return '📄';
  }
}
