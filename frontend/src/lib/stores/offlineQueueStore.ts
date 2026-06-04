import { create } from 'zustand';

export interface QueuedMutation {
  id: string;
  idempotencyKey: string;
  path: string;
  method: string;
  body: unknown;
  createdAt: number;
  retryCount: number;
}

interface OfflineQueueState {
  queue: QueuedMutation[];
  isOnline: boolean;
  isSyncing: boolean;

  addToQueue: (mutation: Omit<QueuedMutation, 'createdAt' | 'retryCount'>) => void;
  removeFromQueue: (id: string) => void;
  setOnline: (v: boolean) => void;
  setIsSyncing: (v: boolean) => void;
  incrementRetry: (id: string) => void;
}

export const useOfflineQueueStore = create<OfflineQueueState>((set, get) => ({
  queue: [],
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,

  addToQueue: (mutation) =>
    set((state) => ({
      queue: [...state.queue, { ...mutation, createdAt: Date.now(), retryCount: 0 }],
    })),

  removeFromQueue: (id) =>
    set((state) => ({ queue: state.queue.filter((m) => m.id !== id) })),

  setOnline: (v) => set({ isOnline: v }),
  setIsSyncing: (v) => set({ isSyncing: v }),

  incrementRetry: (id) =>
    set((state) => ({
      queue: state.queue.map((m) => (m.id === id ? { ...m, retryCount: m.retryCount + 1 } : m)),
    })),
}));
