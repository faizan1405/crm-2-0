/**
 * Checkpoint B14C — Zero-PII Read-Only Browser Origin Presence Check
 *
 * USAGE (Owner runs manually in DevTools Console on candidate CRM V2 origins):
 * - Strictly READ-ONLY: zero localStorage writes, zero IndexedDB mutations, zero network requests.
 * - Zero PII output: prints ONLY origin, boolean presence flags, schema version, and numeric counts.
 *   Never prints customer names, phone numbers, emails, notes, or financial figures.
 */
(async function checkScaleFlowCrmV2OriginPresence() {
  const CRM_KEY = "scale-flow-crm-2-demo";
  const PROOF_DB = "scale-flow-payment-proofs";

  const raw = window.localStorage.getItem(CRM_KEY);
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const st = parsed?.state ?? parsed ?? {};
  const count = (k) => (Array.isArray(st[k]) ? st[k].length : 0);

  let proofCount = 0;
  let proofDbPresent = false;
  if (typeof indexedDB !== "undefined") {
    try {
      if (typeof indexedDB.databases === "function") {
        const dbs = await indexedDB.databases();
        proofDbPresent = dbs.some((d) => d.name === PROOF_DB);
      }
      if (proofDbPresent) {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open(PROOF_DB, 1);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        if (db.objectStoreNames.contains("meta")) {
          const tx = db.transaction(["meta"], "readonly");
          proofCount = await new Promise((resolve, reject) => {
            const c = tx.objectStore("meta").count();
            c.onsuccess = () => resolve(c.result || 0);
            c.onerror = () => reject(c.error);
          });
        }
        db.close();
      }
    } catch {
      // Ignore read errors without modifying browser storage
    }
  }

  const summary = {
    origin: window.location.origin,
    crmV2StoreFound: Boolean(raw),
    storeBytes: raw ? raw.length : 0,
    schemaVersion: parsed?.version ?? null,
    proofDbPresent,
    countsOnlyNoPii: {
      leads: count("leads"),
      archivedLeads: count("bin"),
      deals: count("deals"),
      payments: count("payments"),
      paymentProofs: proofCount,
      quotations: count("quotations"),
      projects: count("projects"),
      followUps: count("followUps"),
      notes: count("notes"),
    },
    browserStorageModified: false,
  };

  console.log(JSON.stringify(summary, null, 2));
  return summary;
})();
