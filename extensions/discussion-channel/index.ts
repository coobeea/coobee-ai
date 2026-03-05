import type { ExtensionModule } from '@main/common/extension';
import { discussionChannel } from './DiscussionChannel';

export default {
  id: 'discussion-channel',
  name: 'Discussion Channel',

  register: (api) => {
    api.logger.info('[DiscussionChannel] Registering...');

    // 注册 ChannelPlugin
    api.registerChannelPlugin(discussionChannel);

    api.logger.info('[DiscussionChannel] Registered successfully');
  }
} as ExtensionModule;
