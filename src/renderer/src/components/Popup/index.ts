import type { App } from 'vue';

import Popup from './index.vue';

export type { PopupPosition, PopupTransition } from './index.vue';

export { Popup };

export default {
  install(app: App) {
    app.component('Popup', Popup);
  }
};
