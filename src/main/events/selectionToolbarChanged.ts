import { log } from '@main/common/logger';

/**
 * 选择工具栏变更事件处理器
 * 事件名: config:selectionToolbar:changed
 * 对应事件: EventTypes.CONFIG_SELECTION_TOOLBAR_CHANGED
 *
 * 控制文本选择时是否显示工具栏
 */
export default (payload: { value: boolean }): void => {
  log.info('[Event] 处理选择工具栏变更事件:', payload.value);
  // TODO: 通知渲染进程更新选择工具栏显示状态
  // 前端需要根据此配置决定是否显示文本选择工具栏
};
