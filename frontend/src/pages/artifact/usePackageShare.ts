/**
 * Share domain of the Package Hub: live-link / snapshot share modal state,
 * the "my shares" drawer, create + revoke mutations and the listing query.
 *
 * Extracted from PackageHubTab; the component destructures the return
 * value so its JSX keeps the original names.
 */
import { useState } from 'react';

import { useAuthStore } from '@/store/auth';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createPackageShare,
  deletePackageShare,
  listPackageShares,
  type PackageShareLink,
  type StorageItem,
} from '@/api/packages';

interface Notify {
  success: (content: string) => void;
  error: (content: string) => void;
}

export function usePackageShare({ message }: { message: Notify }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  // Share Modal state
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareTargetItem, setShareTargetItem] = useState<StorageItem | null>(null);
  const [shareType, setShareType] = useState<'live' | 'snapshot'>('live');
  const [shareExpiresHours, setShareExpiresHours] = useState<number | undefined>(undefined);
  const [shareDesc, setShareDesc] = useState('');
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null);

  // My Shares Drawer state
  const [mySharesDrawerOpen, setMySharesDrawerOpen] = useState(false);

  const { data: myShares = [], refetch: refetchShares } = useQuery({
    queryKey: ['my-package-shares'],
    queryFn: () => listPackageShares(),
    enabled: Boolean(user),
  });

  const createShareMutation = useMutation({
    mutationFn: (payload: {
      source_path: string;
      share_type: 'live' | 'snapshot';
      description?: string;
      expires_in_hours?: number;
    }) => createPackageShare(payload),
    onSuccess: (share: PackageShareLink) => {
      const url = `${window.location.origin}/share/${share.token}`;
      setGeneratedShareUrl(url);
      void queryClient.invalidateQueries({ queryKey: ['my-package-shares'] });
      void navigator.clipboard.writeText(url).then(
        () => message.success('分享链接已创建并复制到剪贴板！'),
        () => message.success('分享链接已创建！'),
      );
    },
    onError: (err) => {
      message.error(`创建分享失败: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const deleteShareMutation = useMutation({
    mutationFn: (token: string) => deletePackageShare(token),
    onSuccess: () => {
      message.success('分享已撤销');
      void queryClient.invalidateQueries({ queryKey: ['my-package-shares'] });
    },
  });

  const handleOpenShare = (record: StorageItem) => {
    setShareTargetItem(record);
    setShareType('live');
    setShareExpiresHours(undefined);
    setShareDesc('');
    setGeneratedShareUrl(null);
    setShareModalOpen(true);
  };

  return {
    shareModalOpen,
    setShareModalOpen,
    shareTargetItem,
    shareType,
    setShareType,
    shareExpiresHours,
    setShareExpiresHours,
    shareDesc,
    setShareDesc,
    generatedShareUrl,
    setGeneratedShareUrl,
    mySharesDrawerOpen,
    setMySharesDrawerOpen,
    myShares,
    refetchShares,
    createShareMutation,
    deleteShareMutation,
    handleOpenShare,
  };
}
