/**
 * 平台检测 Composable
 *
 * 用于检测当前操作系统平台，以应用不同的 UI 样式
 */

import { ref, type Ref } from 'vue';

/**
 * 检测操作系统平台
 */
function detectPlatform(): 'darwin' | 'win32' | 'linux' | 'unknown' {
  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes('mac') || userAgent.includes('darwin')) {
    return 'darwin';
  }

  if (userAgent.includes('win')) {
    return 'win32';
  }

  if (userAgent.includes('linux') || userAgent.includes('x11')) {
    return 'linux';
  }

  return 'unknown';
}

export function usePlatform(): {
  isMacOS: Ref<boolean>;
  isWindows: Ref<boolean>;
  isLinux: Ref<boolean>;
} {
  const platform = detectPlatform();

  const isMacOS = ref(platform === 'darwin');
  const isWindows = ref(platform === 'win32');
  const isLinux = ref(platform === 'linux');

  return {
    isMacOS,
    isWindows,
    isLinux
  };
}
