export function pathToTabId(pathname: string): string | null {
  const clean = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean || clean === 'dashboard') return 'dashboard';
  if (clean === 'plugin/list') return 'plugin-list';
  if (clean === 'plugin/register') return 'plugin-register';
  if (clean === 'store') return 'plugin-store';
  if (clean === 'pipeline/list') return 'pipeline-list';
  if (clean === 'pipeline/create') return 'pipeline-create';
  if (clean === 'pipeline/visual') return 'pipeline-visual';
  if (clean === 'pipeline/history') return 'pipeline-history';
  if (clean === 'task/running') return 'task-running';
  if (clean === 'task/history') return 'task-history';
  if (clean === 'machine') return 'machines';
  if (clean === 'artifact') return 'artifacts';
  if (clean === 'credential' || clean === 'credentials') return 'credential';
  if (clean === 'admin') return 'admin';
  if (clean === 'setting') return 'settings';

  if (clean.startsWith('task/')) {
    const runId = clean.replace('task/', '');
    return `task-detail:${runId}`;
  }
  if (clean.startsWith('pipeline/')) {
    const pipeId = clean.replace('pipeline/', '');
    return `pipeline-detail:${pipeId}`;
  }
  if (clean.startsWith('plugin/')) {
    const parts = clean.replace('plugin/', '').split('/');
    if (parts.length >= 2) {
      return `plugin-detail:${parts[0]}:${parts[1]}`;
    }
  }

  return null;
}
