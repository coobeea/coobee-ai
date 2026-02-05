/**
 * @file Spinner anmation constants
 * @description Generated from @iconify-json/svg-spinners
 */

export const Spinner = {
  TWELVE_DOTS_SCALE_ROTATE: '12-dots-scale-rotate', // 12个点缩放旋转
  RING_180: '180-ring', // 180度圆环
  RING_180_WITH_BG: '180-ring-with-bg', // 带背景的180度圆环
  RING_270: '270-ring', // 270度圆环
  RING_270_WITH_BG: '270-ring-with-bg', // 带背景的270度圆环
  THREE_DOTS_BOUNCE: '3-dots-bounce', // 3个点弹跳
  THREE_DOTS_FADE: '3-dots-fade', // 3个点渐隐
  THREE_DOTS_MOVE: '3-dots-move', // 3个点移动
  THREE_DOTS_ROTATE: '3-dots-rotate', // 3个点旋转
  THREE_DOTS_SCALE: '3-dots-scale', // 3个点缩放
  THREE_DOTS_SCALE_MIDDLE: '3-dots-scale-middle', // 3个点中间缩放
  SIX_DOTS_ROTATE: '6-dots-rotate', // 6个点旋转
  SIX_DOTS_SCALE: '6-dots-scale', // 6个点缩放
  SIX_DOTS_SCALE_MIDDLE: '6-dots-scale-middle', // 6个点中间缩放
  EIGHT_DOTS_ROTATE: '8-dots-rotate', // 8个点旋转
  RING_90: '90-ring', // 90度圆环
  RING_90_WITH_BG: '90-ring-with-bg', // 带背景的90度圆环
  BARS_FADE: 'bars-fade', // 条形渐隐
  BARS_ROTATE_FADE: 'bars-rotate-fade', // 条形旋转渐隐
  BARS_SCALE: 'bars-scale', // 条形缩放
  BARS_SCALE_FADE: 'bars-scale-fade', // 条形缩放渐隐
  BARS_SCALE_MIDDLE: 'bars-scale-middle', // 条形中间缩放
  BLOCKS_SCALE: 'blocks-scale', // 方块缩放
  BLOCKS_SHUFFLE_2: 'blocks-shuffle-2', // 2个方块洗牌
  BLOCKS_SHUFFLE_3: 'blocks-shuffle-3', // 3个方块洗牌
  BLOCKS_WAVE: 'blocks-wave', // 方块波浪
  BOUNCING_BALL: 'bouncing-ball', // 弹跳球
  CLOCK: 'clock', // 时钟
  DOT_REVOLVE: 'dot-revolve', // 单点旋转
  ECLIPSE: 'eclipse', // 月食
  ECLIPSE_HALF: 'eclipse-half', // 半月食
  GOOEY_BALLS_1: 'gooey-balls-1', // 粘性小球1
  GOOEY_BALLS_2: 'gooey-balls-2', // 粘性小球2
  PULSE: 'pulse', // 脉冲
  PULSE_2: 'pulse-2', // 双脉冲
  PULSE_3: 'pulse-3', // 三脉冲
  PULSE_MULTIPLE: 'pulse-multiple', // 多重脉冲
  PULSE_RING: 'pulse-ring', // 脉冲环
  PULSE_RINGS_2: 'pulse-rings-2', // 双脉冲环
  PULSE_RINGS_3: 'pulse-rings-3', // 三脉冲环
  PULSE_RINGS_MULTIPLE: 'pulse-rings-multiple', // 多重脉冲环
  RING_RESIZE: 'ring-resize', // 环形缩放
  TADPOLE: 'tadpole', // 蝌蚪追逐
  WIFI: 'wifi', // Wifi信号
  WIFI_FADE: 'wifi-fade', // Wifi信号渐隐
  WIND_TOY: 'wind-toy' // 风车玩具
} as const

// 从常量的值动态生成 SpinnerType 类型
export type SpinnerType = (typeof Spinner)[keyof typeof Spinner]
