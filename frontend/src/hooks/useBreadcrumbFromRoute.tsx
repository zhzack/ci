import { useLocation, useMatches } from 'react-router-dom';
import type { ItemType } from 'antd/es/breadcrumb/Breadcrumb';

type RouteHandle = {
  breadcrumb?: string;
};

export function useBreadcrumbFromRoute(): ItemType[] {
  const location = useLocation();
  const matches = useMatches();
  const items: ItemType[] = [];
  for (const match of matches) {
    if (match.id === 'root' || match.pathname === location.pathname) {
      continue;
    }
    const handle = match.handle as RouteHandle | undefined;
    const label = handle?.breadcrumb ?? match.pathname;
    items.push({ title: label });
  }
  if (items.length === 0) {
    items.push({ title: 'Dashboard' });
  }
  return items;
}
