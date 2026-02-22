import type { ChannelConfig } from '../common/extension/types';

export interface ChannelStatus {
  id: string;
  name: string;
  status: 'stopped' | 'running' | 'error';
  error?: string;
}

export interface ManagedChannel {
  config: ChannelConfig;
  status: ChannelStatus['status'];
  error?: string;
  abortController?: AbortController;
}
