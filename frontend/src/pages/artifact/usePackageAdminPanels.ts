/**
 * Admin-panel domains of the Package Hub: remote-URL import, storage
 * analytics drawer and directory ACL grants (list / create / revoke).
 *
 * Extracted from PackageHubTab; the component destructures the return
 * value so its JSX keeps the original names.
 */
import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminListUsers,
  adminListTeams,
} from '@/api/admin';
import {
  createPackageGrant,
  getPackageStats,
  importRemotePackage,
  listPackageGrants,
  revokePackageGrant,
} from '@/api/packages';

interface Notify {
  success: (content: string) => void;
  error: (content: string) => void;
}

export function usePackageAdminPanels({
  currentPath,
  message,
}: {
  currentPath: string;
  message: Notify;
}) {
  const queryClient = useQueryClient();
  // --- Remote URL Import state & mutation ---
  const [isImportRemoteModalOpen, setIsImportRemoteModalOpen] = useState(false);
  const [importRemoteUrl, setImportRemoteUrl] = useState('');
  const [importRemoteFilename, setImportRemoteFilename] = useState('');
  const [importRemoteCredentialId, setImportRemoteCredentialId] = useState<string | undefined>(undefined);

  const importRemoteMutation = useMutation({
    mutationFn: () =>
      importRemotePackage({
        url: importRemoteUrl.trim(),
        target_dir: currentPath,
        filename: importRemoteFilename.trim() || undefined,
        credential_id: importRemoteCredentialId || undefined,
      }),
    onSuccess: (item) => {
      message.success(`文件 ${item.name} 已成功下载并保存到当前目录！`);
      setIsImportRemoteModalOpen(false);
      setImportRemoteUrl('');
      setImportRemoteFilename('');
      setImportRemoteCredentialId(undefined);
      void queryClient.invalidateQueries({ queryKey: ['packages', currentPath] });
    },
    onError: (err) => {
      message.error(`远程下载失败: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  // --- Storage Analytics state & query ---
  const [statsDrawerOpen, setStatsDrawerOpen] = useState(false);
  const [statsScope, setStatsScope] = useState<string>('');

  const {
    data: storageStats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['package-storage-stats', statsScope],
    queryFn: () => getPackageStats(statsScope),
    enabled: statsDrawerOpen,
  });

  // --- Directory ACL Grants state & mutations ---
  const [grantModalOpen, setGrantModalOpen] = useState(false);
  const [grantTargetPath, setGrantTargetPath] = useState<string>('');
  const [granteeType, setGranteeType] = useState<'user' | 'team'>('user');
  const [granteeId, setGranteeId] = useState<string>('');
  const [grantPermission, setGrantPermission] = useState<'viewer' | 'operator'>('viewer');

  const { data: grants = [], refetch: refetchGrants, isLoading: grantsLoading } = useQuery({
    queryKey: ['package-grants', grantTargetPath],
    queryFn: () => listPackageGrants(grantTargetPath),
    enabled: grantModalOpen && Boolean(grantTargetPath),
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['admin-users-for-grants'],
    queryFn: adminListUsers,
    enabled: grantModalOpen,
  });

  const { data: allTeams = [] } = useQuery({
    queryKey: ['admin-teams-for-grants'],
    queryFn: adminListTeams,
    enabled: grantModalOpen,
  });

  const createGrantMutation = useMutation({
    mutationFn: () =>
      createPackageGrant({
        path: grantTargetPath,
        grantee_type: granteeType,
        grantee_id: granteeId,
        permission: grantPermission,
      }),
    onSuccess: () => {
      message.success('权限授予成功');
      setGranteeId('');
      void refetchGrants();
    },
    onError: (err) => {
      message.error(`授予权限失败: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const revokeGrantMutation = useMutation({
    mutationFn: (grantId: string) => revokePackageGrant(grantId),
    onSuccess: () => {
      message.success('权限已撤销');
      void refetchGrants();
    },
    onError: (err) => {
      message.error(`撤销权限失败: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  return {
    isImportRemoteModalOpen,
    setIsImportRemoteModalOpen,
    importRemoteUrl,
    setImportRemoteUrl,
    importRemoteFilename,
    setImportRemoteFilename,
    importRemoteCredentialId,
    setImportRemoteCredentialId,
    importRemoteMutation,
    statsDrawerOpen,
    setStatsDrawerOpen,
    statsScope,
    setStatsScope,
    storageStats,
    statsLoading,
    refetchStats,
    grantModalOpen,
    setGrantModalOpen,
    grantTargetPath,
    setGrantTargetPath,
    granteeType,
    setGranteeType,
    granteeId,
    setGranteeId,
    grantPermission,
    setGrantPermission,
    grants,
    refetchGrants,
    grantsLoading,
    allUsers,
    allTeams,
    createGrantMutation,
    revokeGrantMutation,
  };
}
