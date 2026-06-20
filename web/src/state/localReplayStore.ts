import type { ReplaySummary } from '../lib/api/client';
import { summarize } from '../lib/game/replayMeta';

/**
 * Local, browser-side replay library backed by IndexedDB. Replaces the
 * server-side store for the user's own replays: uploads and imported episodes
 * live here, so the library works with no backend and nothing the user opens is
 * persisted on a server. (The Kaggle proxy is still used to *fetch* an episode;
 * its result is then saved here.)
 */

const DB_NAME = 'cabt-replay-viewer';
const STORE = 'replays';
const DB_VERSION = 1;

type StoredReplay = {
  id: string;
  summary: ReplaySummary;
  replay: unknown;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB; local replays are unavailable.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open replay database.'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Replay database request failed.'));
      }),
  );
}

class LocalReplayStore {
  async list(query = ''): Promise<ReplaySummary[]> {
    const records = await tx<StoredReplay[]>('readonly', (store) => store.getAll() as IDBRequest<StoredReplay[]>);
    const summaries = records.map((record) => record.summary);
    summaries.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return summaries;
    }
    return summaries.filter((summary) =>
      [summary.id, summary.name, summary.source, ...summary.players]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }

  async get(id: string): Promise<unknown | null> {
    const record = await tx<StoredReplay | undefined>('readonly', (store) => store.get(id) as IDBRequest<StoredReplay | undefined>);
    return record ? record.replay : null;
  }

  async save(replay: unknown, name?: string): Promise<ReplaySummary> {
    const summary: ReplaySummary = { ...summarize(replay, name), createdAt: new Date().toISOString() };
    await tx('readwrite', (store) => store.put({ id: summary.id, summary, replay } satisfies StoredReplay));
    return summary;
  }

  async remove(id: string): Promise<void> {
    await tx('readwrite', (store) => store.delete(id));
  }
}

export const localReplayStore = new LocalReplayStore();
