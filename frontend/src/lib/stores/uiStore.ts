import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface UiState {
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark' | 'system';
  commandPaletteOpen: boolean;
  pendingToast: { type: 'success' | 'error' | 'info'; message: string } | null;

  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setCommandPaletteOpen: (v: boolean) => void;
  setPendingToast: (toast: UiState['pendingToast']) => void;
  clearPendingToast: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      theme: 'system' as const,
      commandPaletteOpen: false,
      pendingToast: null,

      setSidebarCollapsed: (v: boolean) => set({ sidebarCollapsed: v }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setTheme: (theme: 'light' | 'dark' | 'system') => set({ theme }),
      setCommandPaletteOpen: (v: boolean) => set({ commandPaletteOpen: v }),
      setPendingToast: (toast: UiState['pendingToast']) => set({ pendingToast: toast }),
      clearPendingToast: () => set({ pendingToast: null }),
    }),
    {
      name: 'repairos-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed, theme: state.theme }),
    }
  )
);
