import { create } from 'zustand';
import { uploadPackageFile } from '@/api/packages';

export type UploadTask = {
  id: string;
  file: File;
  name: string;
  relativePath: string;
  targetDir: string;
  size: number;
  loadedBytes: number;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled';
  errorMsg?: string;
  controller?: AbortController;
};

type UploadStore = {
  tasks: UploadTask[];
  isMinimized: boolean;
  isOpen: boolean;
  /** Monotonic counter bumped each time any task lands; pages subscribe. */
  successTick: number;
  addFiles: (files: (File & { webkitRelativePath?: string })[], targetDir: string) => void;
  setMinimized: (minimized: boolean) => void;
  setOpen: (open: boolean) => void;
  cancelTask: (id: string) => void;
  cancelAll: () => void;
  clearCompleted: () => void;
  clearAll: () => void;
};

const MAX_CONCURRENT = 3;

export const useUploadStore = create<UploadStore>((set, get) => {
  let activeCount = 0;

  const processQueue = () => {
    const { tasks } = get();
    const pendingTasks = tasks.filter((t) => t.status === 'pending');

    while (activeCount < MAX_CONCURRENT && pendingTasks.length > 0) {
      const nextTask = pendingTasks.shift();
      if (!nextTask) break;

      const controller = new AbortController();
      activeCount++;

      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === nextTask.id
            ? { ...t, status: 'uploading', progress: 1, controller, loadedBytes: 0 }
            : t,
        ),
      }));

      uploadPackageFile(
        nextTask.file,
        nextTask.targetDir,
        nextTask.relativePath || nextTask.file.name,
        (progress, loadedBytes) => {
          set((state) => ({
            tasks: state.tasks.map((t) =>
              t.id === nextTask.id ? { ...t, progress, loadedBytes } : t,
            ),
          }));
        },
        controller.signal,
      )
        .then(() => {
          set((state) => ({
            tasks: state.tasks.map((t) =>
              t.id === nextTask.id
                ? { ...t, status: 'success', progress: 100, loadedBytes: t.size }
                : t,
            ),
            successTick: state.successTick + 1,
          }));
        })
        .catch((err) => {
          // If cancelled by AbortController, mark as cancelled instead of error
          if (controller.signal.aborted) {
            set((state) => ({
              tasks: state.tasks.map((t) =>
                t.id === nextTask.id
                  ? { ...t, status: 'cancelled', progress: 0 }
                  : t,
              ),
            }));
          } else {
            set((state) => ({
              tasks: state.tasks.map((t) =>
                t.id === nextTask.id
                  ? {
                      ...t,
                      status: 'error',
                      progress: 0,
                      errorMsg: err instanceof Error ? err.message : String(err),
                    }
                  : t,
              ),
            }));
          }
        })
        .finally(() => {
          activeCount--;
          processQueue();
        });
    }
  };

  return {
    tasks: [],
    isMinimized: false,
    isOpen: false,
    successTick: 0,
    addFiles: (files, targetDir) => {
      const newTasks: UploadTask[] = files.map((f, idx) => ({
        id: `${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        name: f.name,
        relativePath: f.webkitRelativePath || '',
        targetDir,
        size: f.size,
        loadedBytes: 0,
        progress: 0,
        status: 'pending',
      }));

      set((state) => ({
        tasks: [...state.tasks, ...newTasks],
        isOpen: true,
      }));

      // Start queue
      setTimeout(processQueue, 0);
    },
    setMinimized: (minimized) => set({ isMinimized: minimized }),
    setOpen: (open) => set({ isOpen: open }),
    cancelTask: (id) => {
      const task = get().tasks.find((t) => t.id === id);
      if (!task) return;
      if (task.controller && !task.controller.signal.aborted) {
        task.controller.abort();
      }
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id ? { ...t, status: 'cancelled', progress: 0 } : t,
        ),
      }));
    },
    cancelAll: () => {
      const { tasks } = get();
      tasks.forEach((t) => {
        if (t.controller && !t.controller.signal.aborted) {
          t.controller.abort();
        }
      });
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.status === 'pending' || t.status === 'uploading'
            ? { ...t, status: 'cancelled', progress: 0 }
            : t,
        ),
      }));
    },
    clearCompleted: () =>
      set((state) => ({
        tasks: state.tasks.filter((t) => t.status === 'pending' || t.status === 'uploading'),
      })),
    clearAll: () => {
      const { tasks } = get();
      tasks.forEach((t) => {
        if (t.controller && !t.controller.signal.aborted) {
          t.controller.abort();
        }
      });
      set({ tasks: [], isOpen: false });
    },
  };
});
