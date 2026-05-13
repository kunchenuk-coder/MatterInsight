/** 材质抠图切片等大二进制：存 IndexedDB，避免塞进 localStorage JSON */

const DB_NAME = "matter_insight_matting";
const DB_VERSION = 1;
const STORE = "matting_slices";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function putMattingSlice(blob: Blob): Promise<string> {
  const id = `mat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve(id);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("putMattingSlice failed"));
    };
    tx.objectStore(STORE).put(blob, id);
  });
}

export async function getMattingSlice(id: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const rq = tx.objectStore(STORE).get(id);
    rq.onsuccess = () => {
      db.close();
      resolve((rq.result as Blob | undefined) ?? null);
    };
    rq.onerror = () => {
      db.close();
      reject(rq.error ?? new Error("getMattingSlice failed"));
    };
  });
}

export async function deleteMattingSlice(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("deleteMattingSlice failed"));
    };
    tx.objectStore(STORE).delete(id);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("blobToDataUrl failed"));
    r.readAsDataURL(blob);
  });
}
