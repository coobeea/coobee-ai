export enum WindowEvents {
  READY_TO_SHOW = 'main-window-ready-to-show',
  CLOSE = 'main-window-close',
  CLOSED = 'main-window-closed'
}

export enum BrowserWindowEvents {
  READY_TO_SHOW = 'ready-to-show',
  SHOW = 'show',
  HIDE = 'hide',
  CLOSE = 'close',
  CLOSED = 'closed',
  MINIMIZE = 'minimize',
  MAXIMIZE = 'maximize',
  UNMAXIMIZE = 'unmaximize',
  RESTORE = 'restore',
  RESIZE = 'resize',
  RESIZED = 'resized',
  MOVE = 'move',
  MOVED = 'moved',
  FOCUS = 'focus',
  BLUR = 'blur',
  ENTER_FULL_SCREEN = 'enter-full-screen',
  LEAVE_FULL_SCREEN = 'leave-full-screen',
  ENTER_HTML_FULL_SCREEN = 'enter-html-full-screen',
  LEAVE_HTML_FULL_SCREEN = 'leave-html-full-screen',
  ALWAYS_ON_TOP_CHANGED = 'always-on-top-changed',
  RESPONSIVE = 'responsive',
  UNRESPONSIVE = 'unresponsive'
}

export enum ElectronAppEvents {
  ACTIVATE = 'activate',
  BROWSER_WINDOW_CREATED = 'browser-window-created',
  BROWSER_WINDOW_FOCUS = 'browser-window-focus',
  BEFORE_QUIT = 'before-quit',
  WILL_QUIT = 'will-quit',
  WINDOW_ALL_CLOSED = 'window-all-closed',
  SECOND_INSTANCE = 'second-instance',
  RENDER_PROCESS_GONE = 'render-process-gone',
  CHILD_PROCESS_GONE = 'child-process-gone'
}
