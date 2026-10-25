import { http } from './http';
import type { Paged } from '@/types/common';
import type { ArtifactListItem } from '@/types/artifact';


import type { ArtifactListParams } from '@/types/artifact';
export type { ArtifactListParams };

export async function listArtifacts(
  params: ArtifactListParams = {},
): Promise<Paged<ArtifactListItem>> {
  const { data } = await http.get<Paged<ArtifactListItem>>('/artifacts', { params });
  return data;
}

export async function publishArtifactToPackages(
  artifactId: string,
  targetDir = 'artifacts',
  filename?: string,
): Promise<unknown> {
  const { data } = await http.post(`/artifacts/${artifactId}/publish-to-packages`, {
    target_dir: targetDir,
    filename,
  });
  return data;
}
