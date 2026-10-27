import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, X, FileText, ZoomIn, ZoomOut, Download, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { checkProofFile, formatBytes, proofLabel, type ProofKind, type ProofMeta } from "@/lib/crm/attachments";
import { idbProofRepo, friendlyStorageError } from "@/lib/crm/proofRepo";

export interface StagedProof { file: File; type: ProofKind }

/** Object URL that is revoked when the blob changes or the component unmounts. */
function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** Hidden file input + validation. Calls onPick only for an accepted file; cancelling does nothing. */
export function useProofPicker(onPick: (p: StagedProof) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input ref={ref} type="file" hidden data-testid="proof-input" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
      onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        const c = await checkProofFile(f);
        if (!c.ok) { toast.error(c.error); return; }
        onPick({ file: f, type: c.type });
      }} />
  );
  return { open: () => ref.current?.click(), input };
}

/** Optional field inside Record Payment. Holds the file in memory only until the payment is saved. */
export function ProofField({ value, onChange }: { value: StagedProof | null; onChange: (p: StagedProof | null) => void }) {
  const picker = useProofPicker(onChange);
  const url = useObjectUrl(value && value.type !== "application/pdf" ? value.file : null);
  return (
    <div className="grid gap-1.5 sm:col-span-2">
      <span className="text-sm font-medium">Attach payment proof <span className="font-normal text-muted-foreground">(optional)</span></span>
      {picker.input}
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border bg-secondary p-2.5">
          {url ? <img src={url} alt="Selected payment proof" className="size-12 rounded-md object-cover" /> : <span className="grid size-12 place-items-center rounded-md bg-card"><FileText className="size-5 text-muted-foreground" /></span>}
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{value.file.name}</div><div className="text-xs text-muted-foreground">{proofLabel(value.type)} · {formatBytes(value.file.size)}</div></div>
          <Button type="button" size="icon" variant="ghost" aria-label="Remove selected file" onClick={() => onChange(null)}><X className="size-4" /></Button>
        </div>
      ) : (
        <button type="button" onClick={picker.open} className="flex items-center justify-center gap-2 rounded-lg border border-dashed bg-card px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
          <Paperclip className="size-4" />Choose screenshot or PDF · JPG, PNG, WebP, PDF · max 10 MB
        </button>
      )}
    </div>
  );
}

/** Save staged proof against a payment; returns false (with message) on failure so the user can retry. */
export async function saveProof(paymentId: string, p: StagedProof): Promise<boolean> {
  try { await idbProofRepo.put(paymentId, p.file, p.file.name, p.type); toast.dismiss(`proof-failed-${paymentId}`); return true; }
  catch (e) { toast.error(`Proof not saved: ${friendlyStorageError(e)}`, { id: `proof-failed-${paymentId}`, description: "The previous proof (if any) is unchanged. Try again." }); return false; }
}

export function PaymentProofPreview({ paymentId, meta, title, onClose }: { paymentId: string; meta: ProofMeta; title: string; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const url = useObjectUrl(blob);
  useEffect(() => {
    let live = true;
    idbProofRepo.get(paymentId).then((r) => { if (!live) return; if (r) { setBlob(r.blob); setState("ready"); } else setState("missing"); }, () => live && setState("missing"));
    return () => { live = false; };
  }, [paymentId, meta.updatedAt]);
  const picker = useProofPicker(async (p) => { setBusy(true); if (await saveProof(paymentId, p)) toast.success("Proof replaced"); setBusy(false); });
  const remove = async () => {
    if (!window.confirm("Remove this payment proof? The payment itself stays unchanged.")) return;
    setBusy(true);
    try { await idbProofRepo.remove(paymentId); toast.success("Proof removed"); onClose(); }
    catch (e) { toast.error(friendlyStorageError(e)); setBusy(false); }
  };
  const isPdf = meta.mimeType === "application/pdf";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payment proof · {title}</DialogTitle>
          <DialogDescription className="truncate">{meta.originalFileName} · {proofLabel(meta.mimeType)} · {formatBytes(meta.fileSize)}</DialogDescription>
        </DialogHeader>
        {picker.input}
        <div className="grid min-h-48 place-items-center overflow-auto rounded-lg border bg-secondary" style={{ maxHeight: "60vh" }}>
          {state === "loading" && <span className="text-sm text-muted-foreground">Loading…</span>}
          {state === "missing" && <span className="p-6 text-center text-sm text-muted-foreground">This file couldn't be found in this browser. Replace it or remove the proof.</span>}
          {state === "ready" && url && (isPdf
            ? <div className="grid place-items-center gap-3 p-8 text-center"><FileText className="size-10 text-muted-foreground" /><span className="text-sm">PDF document</span><Button asChild variant="outline" className="rounded-full"><a href={url} download={meta.originalFileName}><Download className="size-4" />Download PDF</a></Button></div>
            : <img src={url} alt={`Payment proof for ${title}`} className="max-w-none transition-[width]" style={{ width: `${zoom * 100}%` }} />)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            {!isPdf && state === "ready" && <>
              <Button size="icon" variant="ghost" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))}><ZoomOut className="size-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.5))}><ZoomIn className="size-4" /></Button>
              {url && <Button asChild size="icon" variant="ghost" aria-label="Download"><a href={url} download={meta.originalFileName}><Download className="size-4" /></a></Button>}
            </>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={picker.open}><RefreshCw className="size-4" />Replace</Button>
            <Button variant="ghost" disabled={busy} className="text-destructive" onClick={remove}><Trash2 className="size-4" />Remove</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Proof is supporting evidence only — it never changes amounts or balances. Saved in this browser only.</p>
      </DialogContent>
    </Dialog>
  );
}
