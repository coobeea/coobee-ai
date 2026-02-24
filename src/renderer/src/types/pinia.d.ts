import 'pinia';

// 扩展 Pinia 的类型定义
declare module 'pinia' {
  export interface DefineStoreOptionsBase<S> {
    /**
     * 状态同步配置
     */
    sync?: {
      /**
       * 需要同步的状态键名数组
       */
      pick?: (keyof S)[];
    };
  }
}
