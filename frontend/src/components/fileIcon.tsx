import { CodeOutlined, FileImageOutlined, FileTextOutlined, FileZipOutlined, FolderOutlined, ShareAltOutlined } from '@ant-design/icons';
import type { StorageItem } from '@/api/packages';

/**
 * Canonical file-type icon for storage/package listings. Shared by the
 * Package Hub and the share landing page so identical file types always
 * render identically.
 */
export function getFileIcon(item: StorageItem) {
  if (item.is_dir) {
    return <FolderOutlined style={{ color: '#faad14', fontSize: 18 }} />;
  }
  if (item.name.endsWith('.link.json')) {
    return <ShareAltOutlined style={{ color: '#52c41a', fontSize: 18 }} />;
  }
  const ext = item.extension.toLowerCase();
  if (['.zip', '.tar', '.gz', '.tgz'].includes(ext)) {
    return <FileZipOutlined style={{ color: '#722ed1', fontSize: 18 }} />;
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) {
    return <FileImageOutlined style={{ color: '#13c2c2', fontSize: 18 }} />;
  }
  if (['.yaml', '.yml', '.json', '.sh', '.py', '.js', '.ts', '.sql'].includes(ext)) {
    return <CodeOutlined style={{ color: '#1677ff', fontSize: 18 }} />;
  }
  return <FileTextOutlined style={{ color: '#8c8c8c', fontSize: 18 }} />;
}
