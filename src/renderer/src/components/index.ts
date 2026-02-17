import type { App } from 'vue';

import ConfirmPlugin from './Confirm';
import FormPlugin from './Form';
import MessagePlugin from './Message';
import PopoverPlugin from './Popover';
import PopupPlugin from './Popup';
import ToolTipPlugin from './ToolTip';

export default {
  install(app: App): void {
    app.use(MessagePlugin);
    app.use(ConfirmPlugin);
    app.use(FormPlugin);
    app.use(PopoverPlugin);
    app.use(PopupPlugin);
    app.use(ToolTipPlugin);
  }
};
