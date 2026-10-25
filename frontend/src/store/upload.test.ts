import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the transport so the store logic is tested without axios/network.
vi.mock('@/api/packages', () => ({
  uploadPackageFile: vi.fn(),
}));

import { uploadPackageFile } from '@/api/packages';
import { useUploadStore } from './upload';

const mockedUpload = vi.mocked(uploadPackageFile);

function makeFile(name: string, size = 100): File {
  return { name, size, webkitRelativePath: '' } as unknown as File;
}

function resetStore() {
  useUploadStore.setState({ tasks: [], isMinimized: false, isOpen: false, successTick: 0 });
}

describe('upload store successTick broadcast', () => {
  beforeEach(() => {
    resetStore();
    mockedUpload.mockReset();
  });

  it('bumps successTick once per successful task', async () => {
    mockedUpload.mockResolvedValue({ name: 'a.txt' } as never);
    const store = useUploadStore.getState();
    store.addFiles([makeFile('a.txt')], 'dir/');
    store.addFiles([makeFile('b.txt')], 'dir/');

    await vi.waitFor(() => {
      expect(useUploadStore.getState().successTick).toBe(2);
    });

    const tasks = useUploadStore.getState().tasks;
    expect(tasks.map((t) => t.status)).toEqual(['success', 'success']);
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    expect(mockedUpload).toHaveBeenCalledWith(
      expect.anything(),
      'dir/',
      expect.any(String),
      expect.any(Function),
      expect.anything(),
    );
  });

  it('does not bump the tick when the upload fails', async () => {
    mockedUpload.mockRejectedValue(new Error('network down'));
    useUploadStore.getState().addFiles([makeFile('bad.txt')], '');

    await vi.waitFor(() => {
      expect(useUploadStore.getState().tasks[0]?.status).toBe('error');
    });
    expect(useUploadStore.getState().successTick).toBe(0);
    expect(useUploadStore.getState().tasks[0]?.errorMsg).toBe('network down');
  });

  it('marks aborted uploads as cancelled, not error', async () => {
    mockedUpload.mockImplementation(
      (_file, _dir, _rel, _onProgress, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('canceled')));
        }),
    );
    const store = useUploadStore.getState();
    store.addFiles([makeFile('slow.bin')], '');
    const taskId = useUploadStore.getState().tasks[0]!.id;

    await vi.waitFor(() => {
      expect(useUploadStore.getState().tasks[0]?.status).toBe('uploading');
    });
    store.cancelTask(taskId);

    await vi.waitFor(() => {
      expect(useUploadStore.getState().tasks[0]?.status).toBe('cancelled');
    });
    expect(useUploadStore.getState().successTick).toBe(0);
  });
});
