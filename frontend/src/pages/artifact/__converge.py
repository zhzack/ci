# -*- coding: utf-8 -*-
"""Converge: extend the carved hook into usePackageActions (action domain).

Moves the preview state cluster + handleDownload + downloadingPath in as
well, feeds `data`/`setCurrentPath` as parameters, and renames the hook."""
import io
import re

# ---------------------------------------------------------------- hook side
hook = io.open('usePackageBatchSelection.ts', encoding='utf-8').read()

# 1. rename file header + signature, widen options
hook = hook.replace(
    " * Batch-selection domain of the Package Hub: row click / ctrl / shift /\n"
    " * swipe-drag selection state, the batch download/delete/copy actions and\n"
    " * the batch-copy modal state.\n",
    " * Action domain of the Package Hub: row click / ctrl / shift / swipe-drag\n"
    " * selection, preview/edit drawer state, single + batch download/delete/copy,\n"
    " * breadcrumb derivation and the visible-row filter.\n")
hook = hook.replace(
    "interface UsePackageBatchSelectionOptions {\n"
    "  /** Rows currently visible after search filtering. */\n"
    "  filteredItems: StorageItem[];\n"
    "  currentPath: string;\n"
    "  message: Notify;\n"
    "}",
    "interface UsePackageActionsOptions {\n"
    "  /** Query payload for the current directory (drives filteredItems). */\n"
    "  data: DirectoryListing | undefined;\n"
    "  currentPath: string;\n"
    "  setCurrentPath: (p: string) => void;\n"
    "  message: Notify;\n"
    "}")
hook = hook.replace(
    "export function usePackageBatchSelection({\n  filteredItems,\n  currentPath,\n  message,\n}: UsePackageBatchSelectionOptions) {",
    "export function usePackageActions({\n  data,\n  currentPath,\n  setCurrentPath,\n  message,\n}: UsePackageActionsOptions) {")

# 2. import DirectoryListing
hook = hook.replace(
    "  type StorageItem,\n} from '@/api/packages';",
    "  type DirectoryListing,\n  type StorageItem,\n} from '@/api/packages';")

# 3. inject the preview cluster + downloadingPath state right after `Notify` use
anchor = "  const queryClient = useQueryClient"  # not present; use body anchor instead
state_anchor = "  const selectedRowKeys = "
# find first state line of the carved batch block
m = re.search(r'\n(  const \[selectedRowKeys)', hook)
assert m, 'batch state anchor missing'
preview_states = (
    "  // Preview / edit drawer state\n"
    "  const [previewDrawerOpen, setPreviewDrawerOpen] = useState(false);\n"
    "  const [previewLoading, setPreviewLoading] = useState(false);\n"
    "  const [currentPreview, setCurrentPreview] = useState<FilePreview | null>(null);\n"
    "  const [isEditing, setIsEditing] = useState(false);\n"
    "  const [editBuffer, setEditBuffer] = useState('');\n"
    "  const [saveLoading, setSaveLoading] = useState(false);\n"
    "  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);\n\n"
)
hook = hook.replace(m.group(1), preview_states + m.group(1), 1)
hook = hook.replace(
    "  type DirectoryListing,\n",
    "  type DirectoryListing,\n  type FilePreview,\n")

# 4. inject handleDownload + handleOpenPreview + handleSaveText before toggleRowSelection
anchor_fn = "  // Row click & Swipe-drag selection\n"
assert anchor_fn in hook
extra_fns = (
    "  const handleDownload = async (record: StorageItem) => {\n"
    "    setDownloadingPath(record.path);\n"
    "    try {\n"
    "      const filename = record.is_dir ? `${record.name}.zip` : record.name;\n"
    "      await downloadPackageFileDirect(record.path, filename);\n"
    "    } catch {\n"
    "      message.error('下载失败');\n"
    "    } finally {\n"
    "      setDownloadingPath(null);\n"
    "    }\n"
    "  };\n\n"
    "  const handleOpenPreview = async (item: StorageItem) => {\n"
    "    setPreviewLoading(true);\n"
    "    setPreviewDrawerOpen(true);\n"
    "    setIsEditing(false);\n"
    "    try {\n"
    "      const p = await previewPackageFile(item.path);\n"
    "      setCurrentPreview(p);\n"
    "      setEditBuffer(p.content || '');\n"
    "    } catch {\n"
    "      setPreviewDrawerOpen(false);\n"
    "    } finally {\n"
    "      setPreviewLoading(false);\n"
    "    }\n"
    "  };\n\n"
    "  const handleSaveText = async () => {\n"
    "    if (!currentPreview) return;\n"
    "    setSaveLoading(true);\n"
    "    try {\n"
    "      await savePackageFile(currentPreview.path, editBuffer);\n"
    "      message.success('文件保存成功');\n"
    "      setCurrentPreview({\n"
    "        ...currentPreview,\n"
    "        content: editBuffer,\n"
    "        size: new Blob([editBuffer]).size,\n"
    "        line_count: editBuffer.split('\\n').length,\n"
    "      });\n"
    "      setIsEditing(false);\n"
    "      void queryClient.invalidateQueries({ queryKey: ['packages', currentPath] });\n"
    "    } finally {\n"
    "      setSaveLoading(false);\n"
    "    }\n"
    "  };\n\n"
)
hook = hook.replace(anchor_fn, extra_fns + anchor_fn)

# 5. derived filteredItems must come from `data` now (was closure over data)
hook = hook.replace(
    "  const filteredItems = (data?.items || []).filter((item) =>\n"
    "    item.name.toLowerCase().includes(searchFilter.toLowerCase()),\n"
    "  );\n",
    "  const filteredItems = (data?.items || []).filter((item) =>\n"
    "    item.name.toLowerCase().includes(searchFilter.toLowerCase()),\n"
    "  );\n")  # body already has it; but ensure no double definition below

# dedupe if the carved body carried a second filteredItems definition
dup = "  const filteredItems = (data?.items || []).filter((item) =>"
if hook.count(dup) > 1:
    first = hook.index(dup)
    second = hook.index(dup, first + 1)
    # remove the second occurrence block (3 lines)
    end2 = hook.index(');', second) + 2
    hook = hook[:second] + hook[end2 + 1:]

# 6. extend the return list
hook = hook.replace(
    "  return {\n    selectedRowKeys,",
    "  return {\n"
    "    previewDrawerOpen,\n    previewLoading,\n    currentPreview,\n"
    "    isEditing,\n    editBuffer,\n    saveLoading,\n    downloadingPath,\n"
    "    setIsEditing,\n    setEditBuffer,\n    setSaveLoading,\n"
    "    setPreviewDrawerOpen,\n    setCurrentPreview,\n"
    "    filteredItems,\n    breadcrumbItems,\n"
    "    handleDownload,\n    handleOpenPreview,\n    handleSaveText,\n"
    "    handleNavigate,\n    pathSegments,\n"
    "    selectedRowKeys,")

# 7. imports for preview/download APIs
hook = hook.replace(
    "import {\n"
    "  batchCopyPackageItems,",
    "import {\n"
    "  batchCopyPackageItems,\n"
    "  downloadPackageFileDirect,\n"
    "  previewPackageFile,\n"
    "  savePackageFile,")

io.open('usePackageActions.ts', 'w', encoding='utf-8', newline='\n').write(hook)
print('usePackageActions.ts written,', len(hook.splitlines()), 'lines')

# ------------------------------------------------------------- main file side
src = io.open('PackageHubTab.tsx', encoding='utf-8').read()

# remove preview cluster + downloadingPath state (they moved into the hook)
for frag in [
    "  // Preview / Edit state\n",
    "  const [previewDrawerOpen, setPreviewDrawerOpen] = useState(false);\n",
    "  const [previewLoading, setPreviewLoading] = useState(false);\n",
    "  const [currentPreview, setCurrentPreview] = useState<FilePreview | null>(null);\n",
    "  const [isEditing, setIsEditing] = useState(false);\n",
    "  const [editBuffer, setEditBuffer] = useState('');\n",
    "  const [saveLoading, setSaveLoading] = useState(false);\n",
    "  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);\n",
]:
    assert frag in src, frag[:50]
    src = src.replace(frag, '')

# remove handleDownload (still in main file; it moved to the hook)
dl = re.search(r"  const handleDownload = async \(record: StorageItem\) => \{[\s\S]*?\n  \};\n\n", src)
assert dl, 'handleDownload not found'
src = src[:dl.start()] + src[dl.end():]

# the previous partial rewire used the old hook name/params — replace it
old_call = src[src.index("  const {\n    selectedRowKeys,"):]
old_call = old_call[:old_call.index("});\n") + 4]
new_call = (
    "  const {\n"
    "    selectedRowKeys,\n    selectedRows,\n    batchCopyModalOpen,\n    batchCopyTargetDir,\n"
    "    batchActionLoading,\n    isMouseSelecting,\n    setBatchCopyModalOpen,\n    setBatchCopyTargetDir,\n"
    "    setSelectedRowKeys,\n    setSelectedRows,\n    clearSelection,\n"
    "    previewDrawerOpen,\n    previewLoading,\n    currentPreview,\n    isEditing,\n    editBuffer,\n"
    "    saveLoading,\n    downloadingPath,\n    setIsEditing,\n    setEditBuffer,\n    setSaveLoading,\n"
    "    setPreviewDrawerOpen,\n    setCurrentPreview,\n"
    "    filteredItems,\n    breadcrumbItems,\n    pathSegments,\n"
    "    handleDownload,\n    handleOpenPreview,\n    handleSaveText,\n    handleNavigate,\n"
    "    handleBatchDownload,\n    handleBatchDelete,\n    handleBatchCopy,\n"
    "    toggleRowSelection,\n    handleRowMouseDown,\n    handleRowMouseEnter,\n"
    "  } = usePackageActions({ data, currentPath, setCurrentPath, message });\n"
)
src = src.replace(old_call, new_call)

# remove main-file duplicates that now live in the hook
for frag in [
    "  // Breadcrumb items\n",
    "  const pathSegments = currentPath ? currentPath.split('/').filter(Boolean) : [];\n",
]:
    src = src.replace(frag, '')
m = re.search(r"  const breadcrumbItems = \[[\s\S]*?\n  \];\n\n", src)
assert m, 'breadcrumbItems not found'
src = src[:m.start()] + src[m.end():]
m = re.search(r"  const filteredItems = \(data\?\.items \|\| \[\]\)\.filter\(\(item\) =>\n    item\.name\.toLowerCase\(\)\.includes\(searchFilter\.toLowerCase\(\)\),\n  \);\n\n", src)
assert m, 'filteredItems not found'
src = src[:m.start()] + src[m.end():]
m = re.search(r"  const handleOpenPreview = async \(item: StorageItem\) => \{[\s\S]*?\n  \};\n\n", src)
if m:
    src = src[:m.start()] + src[m.end():]
m = re.search(r"  const handleSaveText = async \(\) => \{[\s\S]*?\n  \};\n\n", src)
if m:
    src = src[:m.start()] + src[m.end():]
src = src.replace(
    "import { usePackageBatchSelection } from './usePackageBatchSelection';",
    "import { usePackageActions } from './usePackageActions';")

io.open('PackageHubTab.tsx', 'w', encoding='utf-8', newline='').write(src)
print('PackageHubTab rewired,', len(src.splitlines()), 'lines')
