/**
 * Helper to recursively scan dropped DataTransfer files and folders.
 * Uses WebKit FileSystemEntry API to maintain complete nested folder structures.
 */

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (successCallback: (file: File) => void, errorCallback?: () => void) => void;
  createReader?: () => FileSystemDirectoryReaderLike;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (
    successCallback: (entries: FileSystemEntryLike[]) => void,
    errorCallback?: () => void,
  ) => void;
}

export async function scanDataTransfer(
  dataTransfer: DataTransfer,
): Promise<(File & { webkitRelativePath?: string })[]> {
  const result: (File & { webkitRelativePath?: string })[] = [];

  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    return Array.from(dataTransfer.files || []);
  }

  // Define recursive entry reader
  async function traverseEntry(entry: FileSystemEntryLike | null, path = ''): Promise<void> {
    if (!entry) return;

    if (entry.isFile && entry.file) {
      await new Promise<void>((resolve) => {
        entry.file?.(
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
    } else if (entry.isDirectory && entry.createReader) {
      const dirReader = entry.createReader();
      const currentDirName = entry.name;
      const newPath = path ? `${path}/${currentDirName}` : currentDirName;

      // In Chromium / WebKit, readEntries might return in batches of 100
      const readAllEntries = async (): Promise<FileSystemEntryLike[]> => {
        let entries: FileSystemEntryLike[] = [];
        let batch: FileSystemEntryLike[] = await new Promise((res) => {
          dirReader.readEntries(
            (ents: FileSystemEntryLike[]) => res(ents),
            () => res([]),
          );
        });
        while (batch.length > 0) {
          entries = entries.concat(batch);
          batch = await new Promise((res) => {
            dirReader.readEntries(
              (ents: FileSystemEntryLike[]) => res(ents),
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

  const entries: FileSystemEntryLike[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && item.kind === 'file') {
      const itemWithEntry = item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryLike | null;
      };
      const entry = itemWithEntry.webkitGetAsEntry ? itemWithEntry.webkitGetAsEntry() : null;
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
