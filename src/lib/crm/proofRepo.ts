// Payment-proof repository. Browser prototype: IndexedDB (files never go to localStorage).
// Production swap point: implement ProofRepo against authenticated Hostinger endpoints
// (private storage, server-side validation and finance-permission checks on every read).
import { useEffect, useState, useSyncExternalStore } from "react";
import { readBytes, type ProofMeta, type ProofKind } from "./attachments";

export interface ProofRepo {
  list(): Promise<ProofMeta[]>;
  get(paymentId: string): Promise<{ meta: ProofMeta; blob: Blob } | null>;
  /** Saves or replaces the single proof of a payment; metadata and file are written in one transaction. */
  put(paymentId: string, file: Blob, name: string, type: ProofKind): Promise<ProofMeta>;
  remove(paymentId: string): Promise<void>;
}

const DB = "scale-flow-payment-proofs";
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new Error("File storage isn't available in this browser"));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("meta", { keyPath: "paymentId" }); r.result.createObjectStore("files"); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error ?? new Error("Storage aborted")); });
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export function friendlyStorageError(e: unknown): string {
  const n = (e as { name?: string })?.name;
  if (n === "QuotaExceededError") return "Browser storage is full — free up space and try again";
  return (e as Error)?.message || "Couldn't save the file in this browser";
}

const busy = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const bump = () => { version++; listeners.forEach((l) => l()); };

export const PROOF_PREVIEW_DENIED = "Payment proofs can't be added, replaced or removed in an employee preview. Nothing was changed.";
/** E1.1B: during an employee preview, only proofs of payments in the employee's scoped copy are readable, and files are never written. */
const previewVisible = (paymentId: string) => !activePreview() || useCRM.getState().payments.some((p) => p.id === paymentId);

export const idbProofRepo: ProofRepo = {
  async list() { const d = await db(); const all = await req(d.transaction("meta").objectStore("meta").getAll() as IDBRequest<ProofMeta[]>); return all.filter((m) => previewVisible(m.paymentId)); },
  async get(paymentId) {
    if (!previewVisible(paymentId)) return null;
    const d = await db(); const t = d.transaction(["meta", "files"]);
    const [meta, blob] = await Promise.all([req(t.objectStore("meta").get(paymentId) as IDBRequest<ProofMeta | undefined>), req(t.objectStore("files").get(paymentId) as IDBRequest<ArrayBuffer | undefined>)]);
    return meta && blob && blob.byteLength > 0 ? { meta, blob: new Blob([blob], { type: meta.mimeType }) } : null;
  },
  async put(paymentId, file, name, type) {
    if (activePreview()) throw new Error(PROOF_PREVIEW_DENIED);
    if (busy.has(paymentId)) throw new Error("This payment's proof is already being saved");
    busy.add(paymentId);
    try {
      const d = await db();
      const buf = await readBytes(file); // store a plain copy, detached from the picked file
      const prev = await req(d.transaction("meta").objectStore("meta").get(paymentId) as IDBRequest<ProofMeta | undefined>);
      const now = new Date().toISOString();
      const meta: ProofMeta = { attachmentId: `proof_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, paymentId, originalFileName: name, mimeType: type, fileSize: buf.byteLength, createdAt: prev?.createdAt ?? now, updatedAt: now };
      const t = d.transaction(["meta", "files"], "readwrite");
      t.objectStore("files").put(buf, paymentId);
      t.objectStore("meta").put(meta);
      await done(t); bump();
      return meta;
    } finally { busy.delete(paymentId); }
  },
  async remove(paymentId) {
    const d = await db(); const t = d.transaction(["meta", "files"], "readwrite");
    t.objectStore("meta").delete(paymentId); t.objectStore("files").delete(paymentId);
    await done(t); bump();
  },
};

/** Map of paymentId → proof metadata; refreshes whenever the repo changes. */
export function useProofIndex(repo: ProofRepo = idbProofRepo) {
  const v = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version, () => 0);
  const [map, setMap] = useState<Record<string, ProofMeta>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    repo.list().then((all) => { if (live) { setMap(Object.fromEntries(all.map((m) => [m.paymentId, m]))); setError(null); } }, (e) => live && setError(friendlyStorageError(e)));
    return () => { live = false; };
  }, [repo, v]);
  return { map, error };
}
