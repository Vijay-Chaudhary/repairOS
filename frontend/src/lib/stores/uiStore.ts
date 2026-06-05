import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface UiState {
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark' | 'system';
  commandPaletteOpen: boolean;
  pendingToast: { type: 'success' | 'error' | 'info'; message: string } | null;
  navGroupsOpen: Record<string, boolean>;

  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setCommandPaletteOpen: (v: boolean) => void;
  setPendingToast: (toast: UiState['pendingToast']) => void;
  clearPendingToast: () => void;
  toggleNavGroup: (label: string) => void;
  setNavGroupOpen: (label: string, open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      theme: 'system' as const,
      commandPaletteOpen: false,
      pendingToast: null,
      navGroupsOpen: {},

      setSidebarCollapsed: (v: boolean) => set({ sidebarCollapsed: v }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setTheme: (theme: 'light' | 'dark' | 'system') => set({ theme }),
      setCommandPaletteOpen: (v: boolean) => set({ commandPaletteOpen: v }),
      setPendingToast: (toast: UiState['pendingToast']) => set({ pendingToast: toast }),
      clearPendingToast: () => set({ pendingToast: null }),
      toggleNavGroup: (label: string) =>
        set((s) => ({ navGroupsOpen: { ...s.navGroupsOpen, [label]: !s.navGroupsOpen[label] } })),
      setNavGroupOpen: (label: string, open: boolean) =>
        set((s) => ({ navGroupsOpen: { ...s.navGroupsOpen, [label]: open } })),
    }),
    {
      name: 'repairos-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        navGroupsOpen: state.navGroupsOpen,
      }),
    }
  )
);
