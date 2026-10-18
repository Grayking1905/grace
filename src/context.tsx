import { createContext, useContext, type ReactNode } from 'react';
import type { Bootstrap } from '../shared/types';
import type { OrganizationWork, OrganizationWorkKind } from '../shared/organization';
export interface AppContextValue {
  data: Bootstrap;
  refresh: () => Promise<void>;
  run: <T>(task: () => Promise<T>, message?: string) => Promise<T | undefined>;
  toast: (message: string, error?: boolean, action?: { label: string; run: () => void }) => void;
  openIssue: (id: string) => void;
  openCreate: (defaults?: Record<string, unknown>) => void;
  openProjectCreate: () => void;
  openCreateMenu?: () => void;
  openWork?: (kind: OrganizationWorkKind, teamId?: string, item?: OrganizationWork) => void;
}
export const AppContext = createContext<AppContextValue | null>(null);
export function useGrace() {
  const value = useContext(AppContext);
  if (!value) throw new Error('Grace context is unavailable');
  return value;
}
export function GraceProvider({
  value,
  children,
}: {
  value: AppContextValue;
  children: ReactNode;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
