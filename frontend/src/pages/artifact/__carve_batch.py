# -*- coding: utf-8 -*-
"""Carve the batch-selection domain out of PackageHubTab (line ranges)."""
import io
import re

LINES = io.open('PackageHubTab.tsx', encoding='utf-8').read().splitlines(keepends=True)

def find_line(pattern, start=0):
    rx = re.compile(pattern)
    for i in range(start, len(LINES)):
        if rx.match(LINES[i]):
            return i
    raise SystemExit(f"not found: {pattern}")

def carve(name, s, e):
    """ inclusive line indexes; swallow trailing `  );` for 4-space dep arrays. """
    if re.match(r'^    \[', LINES[e]) and e + 1 < len(LINES) and LINES[e + 1].rstrip() == '  );':
        e += 1
    block = ''.join(LINES[s:e + 1])
    return name, s, e, block

blocks = []
blocks.append(carve('state_a',
    find_line(r'^  const \[selectedRowKeys, setSelectedRowKeys\]'),
    find_line(r'^  const \[batchActionLoading, setBatchActionLoading\]')))
blocks.append(carve('state_b',
    find_line(r'^  const \[isMouseSelecting, setIsMouseSelecting\]'),
    find_line(r'^  const \[isMouseSelecting, setIsMouseSelecting\]')))
blocks.append(carve('refs',
    find_line(r'^  const dragStartIndexRef'),
    find_line(r'^  const lastClickedIndexRef')))
blocks.append(carve('mouseup_effect',
    find_line(r'^  // Global mouseup to finish drag/swipe selection'),
    find_line(r'^  \}, \[isMouseSelecting\]\);')))
blocks.append(carve('batch_fns',
    find_line(r'^  const handleBatchDownload = async \(\) => \{'),
    find_line(r'^  const handleRowMouseEnter = ')))
# handleRowMouseEnter body runs to its own `  };`
s, e = blocks[-1][1], blocks[-1][2]
j = e
while j < len(LINES) and not re.match(r'^  \};$', LINES[j]):
    j += 1
blocks[-1] = ('batch_fns', s, j, ''.join(LINES[s:j + 1]))

prev = -1
for name, s, e, _ in blocks:
    assert s > prev, (name, s, prev)
    prev = e
    print(f"{name}: {s + 1}-{e + 1} ({e - s + 1} lines)")

body = '\n'.join(b[3].rstrip('\n') + '\n' for b in blocks)

# delete bottom-up, keep the first non-blank line after each block
for name, s, e, _ in sorted(blocks, key=lambda b: -b[1]):
    j = e + 1
    while j < len(LINES) and LINES[j].strip() == '':
        j += 1
    del LINES[s:j]

io.open('PackageHubTab.tsx', 'w', encoding='utf-8', newline='').write(''.join(LINES))
print('drawer now', len(LINES), 'lines')

names = [
    "selectedRowKeys", "selectedRows", "batchCopyModalOpen", "batchCopyTargetDir",
    "batchActionLoading", "isMouseSelecting",
    "setBatchCopyModalOpen", "setBatchCopyTargetDir",
    "setSelectedRowKeys", "setSelectedRows",
    "clearSelection",
    "handleBatchDownload", "handleBatchDelete", "handleBatchCopy",
    "toggleRowSelection", "handleRowMouseDown", "handleRowMouseEnter",
]
return_list = "\n".join("    " + n + "," for n in names)

hook = (
    "/**\n"
    " * Batch-selection domain of the Package Hub: row click / ctrl / shift /\n"
    " * swipe-drag selection state, the batch download/delete/copy actions and\n"
    " * the batch-copy modal state.\n"
    " *\n"
    " * Extracted from PackageHubTab; the component destructures the return\n"
    " * value so its JSX keeps the original names. `filteredItems` is injected\n"
    " * (range selection indexes into the currently visible rows).\n"
    " */\n"
    "import { useEffect, useRef, useState } from 'react';\n"
    "\n"
    "import { useQueryClient } from '@tanstack/react-query';\n"
    "\n"
    "import {\n"
    "  batchCopyPackageItems,\n"
    "  batchDeletePackageItems,\n"
    "  batchDownloadPackagesDirect,\n"
    "  type StorageItem,\n"
    "} from '@/api/packages';\n"
    "\n"
    "interface Notify {\n"
    "  success: (content: string) => void;\n"
    "  error: (content: string) => void;\n"
    "}\n"
    "\n"
    "interface UsePackageBatchSelectionOptions {\n"
    "  /** Rows currently visible after search filtering. */\n"
    "  filteredItems: StorageItem[];\n"
    "  currentPath: string;\n"
    "  message: Notify;\n"
    "}\n"
    "\n"
    "export function usePackageBatchSelection({\n"
    "  filteredItems,\n"
    "  currentPath,\n"
    "  message,\n"
    "}: UsePackageBatchSelectionOptions) {\n"
    + body +
    "\n  const clearSelection = () => {\n"
    "    setSelectedRowKeys([]);\n"
    "    setSelectedRows([]);\n"
    "  };\n"
    "\n"
    "  return {\n" + return_list + "\n  };\n"
    "}\n"
)
io.open('usePackageBatchSelection.ts', 'w', encoding='utf-8', newline='\n').write(hook)
print('usePackageBatchSelection.ts written,', len(hook.splitlines()), 'lines')

# rewire main file
src = ''.join(LINES)
anchor = "  const mySharesDrawerOpen = "
idx = src.index(anchor)
# insert hook call right before the myShares drawer state line
hook_call = (
    "  const queryClient = useQueryClient();\n"  # placeholder replaced below
)
# Build the destructuring with the hook injected after `const message = ...`
anchor2 = "  const { message } = AntApp.useApp();\n"
assert src.count(anchor2) == 1
destructure_names = [
    "selectedRowKeys", "selectedRows", "batchCopyModalOpen", "batchCopyTargetDir",
    "batchActionLoading", "isMouseSelecting",
    "setBatchCopyModalOpen", "setBatchCopyTargetDir",
    "setSelectedRowKeys", "setSelectedRows",
    "clearSelection",
    "handleBatchDownload", "handleBatchDelete", "handleBatchCopy",
    "toggleRowSelection", "handleRowMouseDown", "handleRowMouseEnter",
]
destructure = (
    "\n  const {\n"
    + "\n".join("    " + n + "," for n in destructure_names)
    + "\n  } = usePackageBatchSelection({ filteredItems, currentPath, message });\n"
)
# filteredItems is defined AFTER this point in the file; the hook needs it at
# call time. Place the hook call right after `const filteredItems = ...`
anchor3 = "  const filteredItems = (data?.items || []).filter((item) =>\n    item.name.toLowerCase().includes(searchFilter.toLowerCase()),\n  );\n"
assert src.count(anchor3) == 1, src.count(anchor3)
src = src.replace(anchor3, anchor3 + destructure)
src = src.replace(anchor2, anchor2 + "\n  const queryClient = useQueryClient();")
# remove the now-duplicate queryClient declaration if it existed before
src = src.replace("  const queryClient = useQueryClient();\n  const user = useAuthStore", "  const user = useAuthStore")
# navigate uses clearSelection now
old_nav = "  const handleNavigate = (newPath: string) => {\n    setSelectedRowKeys([]);\n    setSelectedRows([]);\n    setCurrentPath(newPath);\n  };"
assert src.count(old_nav) == 1
src = src.replace(old_nav, "  const handleNavigate = (newPath: string) => {\n    clearSelection();\n    setCurrentPath(newPath);\n  };")
# import the hook
anchor4 = "import { getFileIcon } from '@/components/fileIcon';"
assert src.count(anchor4) == 1
src = src.replace(anchor4, anchor4 + "\nimport { usePackageBatchSelection } from './usePackageBatchSelection';")

io.open('PackageHubTab.tsx', 'w', encoding='utf-8', newline='').write(src)
print('rewired,', len(src.splitlines()), 'lines')
