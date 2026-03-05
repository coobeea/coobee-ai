import type { ExtensionModule } from '../../src/main/common/extension';
import { discussionChannel } from './DiscussionChannel';

export default {
  id: 'discussion-channel',
  name: 'Discussion Channel',

  register: async (api) => {
    api.logger.info('[DiscussionChannel] Registering...');

    // 注册 ChannelPlugin
    await api.registerChannelPlugin(discussionChannel);

    api.logger.info('[DiscussionChannel] Registered successfully');
  }
} as ExtensionModule;
