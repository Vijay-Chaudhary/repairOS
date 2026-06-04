import { openDB, type IDBPDatabase } from 'idb';
import { apiFetch } from '@/lib/api/client';
import { useOfflineQueueStore, type QueuedMutation } from '@/lib/stores/offlineQueueStore';

const DB_NAME = 'repairos-offline';
const STORE_NAME = 'mutations';
const DB_VERSION = 1;

let db: IDBPDatabase | null = null;

async function getDb() {
  if (db) return db;
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
  return db;
}

export async function enqueueOfflineMutation(mutation: Omit<QueuedMutation, 'createdAt' | 'retryCount'>) {
  const full: QueuedMutation = { ...mutation, createdAt: Date.now(), retryCount: 0 };
  const database = await getDb();
  await database.put(STORE_NAME, full);
  useOfflineQueueStore.getState().addToQueue(mutation);
}

export async function flushOfflineQueue() {
  const store = useOfflineQueueStore.getState();
  if (store.isSyncing) return;

  const database = await getDb();
  const all: QueuedMutation[] = await database.getAll(STORE_NAME);
  if (all.length === 0) return;

  store.setIsSyncing(true);

  for (const mutation of all) {
    try {
      await apiFetch(mutation.path, {
        method: mutation.method,
        body: mutation.body !== undefined ? JSON.stringify(mutation.body) : undefined,
        idempotencyKey: mutation.idempotencyKey,
      } as RequestInit & { idempotencyKey: string });
      await database.delete(STORE_NAME, mutation.id);
      store.removeFromQueue(mutation.id);
    } catch {
      store.incrementRetry(mutation.id);
      if (mutation.retryCount >= 3) {
        await database.delete(STORE_NAME, mutation.id);
        store.removeFromQueue(mutation.id);
      }
    }
  }

  store.setIsSyncing(false);
}

export async function loadQueueFromDb() {
  const database = await getDb();
  const all: QueuedMutation[] = await database.getAll(STORE_NAME);
  const store = useOfflineQueueStore.getState();
  all.forEach((m) => store.addToQueue(m));
}
