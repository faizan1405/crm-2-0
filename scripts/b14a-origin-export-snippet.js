/**
 * Checkpoint B14A — Owner-Initiated Read-Only Original-Origin Browser Export Helper
 *
 * USAGE (ONLY when explicitly run by the Owner on their original CRM origin, e.g. crm.joinscaleflow.in):
 * - Strictly READ-ONLY: never calls localStorage.setItem/removeItem/clear or IndexedDB readwrite transactions.
 * - Zero network requests: saves a single local JSON export file (including base64 payment proofs + SHA-256)
 *   directly to the Owner's computer.
 * - Verify offline afterwards with:
 *     node scripts/b13c-offline-migration-preview.mjs --file <downloaded-file.json>
 */
(async function exportScaleFlowOriginalOriginReadOnly() {
  const CRM_KEY = "scale-flow-crm-2-demo";
  const PROOF_DB = "scale-flow-payment-proofs";
  const SIDEBAR_GROUPS_KEY = "scale-flow-sidebar-groups";
  const SIDEBAR_COLLAPSED_KEY = "scale-flow-sidebar-collapsed";

  async function sha256Hex(uint8) {
    const digest = await crypto.subtle.digest("SHA-256", uint8);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function bytesToBase64(uint8) {
    let bin = "";
    for (let i = 0; i < uint8.length; i++) bin += String.fromCharCode(uint8[i]);
    return btoa(bin);
  }

  // 1. Read localStorage (READ-ONLY)
  const rawCrm = window.localStorage.getItem(CRM_KEY);
  const parsedCrm = rawCrm ? JSON.parse(rawCrm) : null;
  const sidebarGroups = window.localStorage.getItem(SIDEBAR_GROUPS_KEY);
  const sidebarCollapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);

  // 2. Read IndexedDB payment proofs (READ-ONLY)
  const proofs = [];
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(PROOF_DB, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (db.objectStoreNames.contains("meta") && db.objectStoreNames.contains("files")) {
        const tx = db.transaction(["meta", "files"], "readonly");
        const metas = await new Promise((resolve, reject) => {
          const r = tx.objectStore("meta").getAll();
          r.onsuccess = () => resolve(r.result || []);
          r.onerror = () => reject(r.error);
        });
        for (const meta of metas) {
          const buf = await new Promise((resolve, reject) => {
            const r = tx.objectStore("files").get(meta.paymentId);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
          });
          if (buf) {
            const bytes = new Uint8Array(buf);
            proofs.push({
              ...meta,
              sha256: await sha256Hex(bytes),
              fileSize: bytes.byteLength,
              contentBase64: bytesToBase64(bytes),
            });
          } else {
            proofs.push({ ...meta, sha256: null, contentBase64: null });
          }
        }
      }
      db.close();
    } catch (err) {
      console.warn("IndexedDB proof read warning (storage untouched):", err);
    }
  }

  const exportPayload = {
    exportFormat: "scale-flow-b14a-origin-readonly-v1",
    exportedAt: new Date().toISOString(),
    origin: window.location.origin,
    browserStorageModified: false,
    crmStoreFound: Boolean(parsedCrm),
    state: parsedCrm?.state ?? parsedCrm ?? {},
    version: parsedCrm?.version ?? null,
    attachments: proofs,
    uiPreferences: {
      [SIDEBAR_GROUPS_KEY]: sidebarGroups ? JSON.parse(sidebarGroups) : null,
      [SIDEBAR_COLLAPSED_KEY]: sidebarCollapsed,
    },
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(exportPayload, null, 2));
  const bundleSha256 = await sha256Hex(jsonBytes);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `ScaleFlow_Origin_ReadOnly_Export_${stamp}.json`;

  const blob = new Blob([jsonBytes], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  console.info(
    `[Scale Flow B14A] Read-only export downloaded: ${filename} (${jsonBytes.byteLength} bytes, proofs: ${proofs.length}, SHA-256: ${bundleSha256}). Original browser storage was NOT modified.`,
  );
})();
