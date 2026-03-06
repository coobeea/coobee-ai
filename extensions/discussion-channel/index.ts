import type { ExtensionModule } from '../../src/main/common/extension';
import { createDiscussionChannel } from './DiscussionChannel';

export default {
  id: 'discussion-channel',
  name: 'Discussion Channel',

  register: async (api) => {
    api.logger.info('[DiscussionChannel] Registering...');

    // 创建并注册 ChannelPlugin（传入 api 以便访问系统服务）
    const discussionChannel = createDiscussionChannel(api);
    await api.registerChannelPlugin(discussionChannel);

    api.logger.info('[DiscussionChannel] Registered successfully');
  }
} as ExtensionModule;
