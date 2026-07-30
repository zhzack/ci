import { http } from './http';
import type { ArtifactListItem } from '@/types/artifact';

export async function listArtifacts(): Promise<ArtifactListItem[]> {
  const { data } = await http.get<ArtifactListItem[]>('/artifacts');
  return data;
}
