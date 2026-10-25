/** Row shape of GET /api/artifacts (paginated catalog across runs).
 *  Distinct from ArtifactResponse (nested in a run's tasks) on purpose:
 *  this shape carries run/task provenance and creation time. */
export type ArtifactListItem = {
  id: string;
  run_id: string;
  task_id: string;
  name: string;
  size: number;
  sha256: string;
  created_at: string;
};

export type ArtifactListParams = {
  page?: number;
  page_size?: number;
  run_id?: string;
};
