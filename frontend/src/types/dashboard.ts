import type { PipelineRun } from './run';
import type { PipelineRecord } from './pipeline';
import type { PluginVersion } from './plugin';

export type DashboardSummary = {
  counts: {
    plugins: number;
    pipelines: number;
    running_tasks: number;
    failed_tasks: number;
  };
  recent_runs: PipelineRun[];
  pipelines: PipelineRecord[];
  plugins: PluginVersion[];
  system: {
    version: string;
    environment: string;
    api_url: string;
  };
};
