/**
 * Helper to recursively scan dropped DataTransfer files and folders.
 * Uses WebKit FileSystemEntry API to maintain complete nested folder structures.
 */

export async function scanDataTransfer(
  dataTransfer: DataTransfer,
): Promise<(File & { webkitRelativePath?: string })[]> {
  const result: (File & { webkitRelativePath?: string })[] = [];

  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    return Array.from(dataTransfer.files || []);
  }

  // Define recursive entry reader
  async function traverseEntry(entry: any, path = ''): Promise<void> {
    if (!entry) return;

    if (entry.isFile) {
      await new Promise<void>((resolve) => {
        entry.file(
          (file: File) => {
            const relPath = path ? `${path}/${file.name}` : file.name;
            Object.defineProperty(file, 'webkitRelativePath', {
              value: relPath,
              writable: true,
            });
            result.push(file as File & { webkitRelativePath?: string });
            resolve();
          },
          () => resolve(),
        );
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const currentDirName = entry.name as string;
      const newPath = path ? `${path}/${currentDirName}` : currentDirName;

      // In Chromium / WebKit, readEntries might return in batches of 100
      const readAllEntries = async (): Promise<any[]> => {
        let entries: any[] = [];
        let batch: any[] = await new Promise((res) => {
          dirReader.readEntries(
            (ents: any[]) => res(ents),
            () => res([]),
          );
        });
        while (batch.length > 0) {
          entries = entries.concat(batch);
          batch = await new Promise((res) => {
            dirReader.readEntries(
              (ents: any[]) => res(ents),
              () => res([]),
            );
          });
        }
        return entries;
      };

      const children = await readAllEntries();
      for (const child of children) {
        await traverseEntry(child, newPath);
      }
    }
  }

  const entries: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && item.kind === 'file') {
      const entry = (item as any).webkitGetAsEntry ? (item as any).webkitGetAsEntry() : null;
      if (entry) {
        entries.push(entry);
      }
    }
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      await traverseEntry(entry);
    }
    return result;
  }

  // Fallback to simple files list
  return Array.from(dataTransfer.files || []);
}
