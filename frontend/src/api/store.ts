import { http } from './http';
import type { PluginVersion } from '@/types/plugin';


import type { PublishRequestPayload } from '@/types/store';
export type { PublishRequestPayload };

/** Submit a personal plugin for store review (202 until an admin approves). */
export async function requestPublish(pluginId: string): Promise<void> {
  await http.post('/plugins/store/publish', { plugin_id: pluginId } satisfies PublishRequestPayload);
}

/** Admin: approve or reject a store publication request. */
export async function reviewPlugin(pluginId: string, approve: boolean): Promise<void> {
  await http.post(
    `/plugins/store/review?approve=${approve ? 'true' : 'false'}`,
    { plugin_id: pluginId },
  );
}

/** Store catalog: approved public plugins plus everything the caller owns. */
export async function listStorePlugins(params: {
  page?: number;
  page_size?: number;
} = {}): Promise<{ items: PluginVersion[]; total: number; page: number; page_size: number; pages: number }> {
  const { data } = await http.get('/plugins/store', { params });
  return data;
}
