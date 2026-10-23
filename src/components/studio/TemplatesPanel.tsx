import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Copy, Trash2, Star, RotateCcw, AlertTriangle, MessagesSquare, FileText, LayoutTemplate, PenLine } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { uid } from "@/lib/crm/format";
import { PLACEHOLDERS, renderTemplate, selectedDemos, templateVars, placeholderIssues, type TemplatePurpose, type WaTemplate } from "@/lib/crm/studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { selectCls } from "@/components/crm/Shell";
import { cn } from "@/lib/utils";

const PURPOSES: { key: TemplatePurpose; label: string; icon: typeof FileText }[] = [
  { key: "followup", label: "Follow-up", icon: MessagesSquare },
  { key: "quotation", label: "Quotation", icon: FileText },
  { key: "samples", label: "Samples / Demos", icon: LayoutTemplate },
  { key: "custom", label: "Custom", icon: PenLine },
];

export function TemplatesPanel() {
  const { waTemplates, saveTemplate, deleteTemplate, setDefaultTemplate, resetTemplates, leads, demos, owner, business, deals } = useCRM();
  const [selId, setSelId] = useState<string | null>(waTemplates[0]?.id ?? null);
  const saved = waTemplates.find((t) => t.id === selId);
  const [draft, setDraft] = useState<WaTemplate | null>(saved ?? null);
  const [previewLead, setPreviewLead] = useState(leads[0]?.id ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = !!draft && (!saved || JSON.stringify({ ...draft, updatedAt: "" }) !== JSON.stringify({ ...saved, updatedAt: "" }));
  const select = (t: WaTemplate) => { if (t.id === selId) return; if (dirty && !window.confirm("Discard unsaved template changes?")) return; setSelId(t.id); setDraft(t); };
  const create = (purpose: TemplatePurpose) => { if (dirty && !window.confirm("Discard unsaved template changes?")) return; const t: WaTemplate = { id: uid("tpl"), purpose, name: "New template", body: "Hi {firstName}, this is {ownerName} from {businessName}. ", isDefault: false, enabled: true, updatedAt: "" }; setSelId(t.id); setDraft(t); };
  const save = () => { if (!draft) return; if (!draft.name.trim() || !draft.body.trim()) { toast.error("Add a name and message"); return; } const bad = placeholderIssues(draft.body); if (bad.length) { toast.error(`Fix unsupported placeholder ${bad.join(", ")} before saving`); return; } saveTemplate({ ...draft, name: draft.name.trim() }); toast.success("Template saved — the WhatsApp composer uses it right away"); };
  const insert = (k: string) => {
    if (!draft) return;
    const el = bodyRef.current; const token = `{${k}}`;
    const at = el?.selectionStart ?? draft.body.length;
    setDraft({ ...draft, body: draft.body.slice(0, at) + token + draft.body.slice(el?.selectionEnd ?? at) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
  };
  const lead = leads.find((l) => l.id === previewLead);
  const preview = useMemo(() => {
    if (!draft || !lead) return "";
    const dealName = deals.find((d) => d.leadId === lead.id && d.status !== "cancelled")?.name;
    return renderTemplate(draft.body, templateVars(lead, { owner, business, dealName, demos: selectedDemos(demos) }));
  }, [draft, lead, demos, owner, business, deals]);
  const unknown = draft ? placeholderIssues(draft.body) : [];

  return (
    <div className="studio-split">
      <div className="studio-list" aria-label="Templates">
        {PURPOSES.map((p) => { const items = waTemplates.filter((t) => t.purpose === p.key); return (
          <div key={p.key} className="grid gap-1">
            <div className="flex items-center justify-between px-2 pt-2"><span className="eyebrow flex items-center gap-1.5"><p.icon className="size-3.5" />{p.label}</span><button type="button" aria-label={`New ${p.label} template`} onClick={() => create(p.key)} className="topbar-icon size-7"><Plus className="size-3.5" /></button></div>
            {items.length === 0 && <p className="px-2 pb-1 text-[11px] text-muted-foreground">No templates</p>}
            {items.map((t) => <button key={t.id} type="button" aria-selected={selId === t.id} onClick={() => select(t)} className={cn("studio-row py-2", !t.enabled && "opacity-55")}><span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{t.name}</span>{t.isDefault && <span className="q-status" data-status="ready">Default</span>}{!t.enabled && <span className="q-status" data-status="draft">Off</span>}</button>)}
          </div>); })}
        <div className="border-t p-2"><Button size="sm" variant="ghost" className="w-full" onClick={() => { if (window.confirm("Restore the built-in Follow-up, Quotation and Samples templates? Your custom templates stay.")) { resetTemplates(); setSelId(null); setDraft(null); toast.success("Built-in templates restored"); } }}><RotateCcw />Reset built-in defaults</Button></div>
      </div>
      {draft ? (
        <div className="grid content-start gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="q-field"><span>Template name</span><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <div className="flex items-end gap-4 pb-2"><label className="flex items-center gap-2 text-xs font-semibold"><Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} aria-label="Template enabled" />Enabled</label></div>
          </div>
          <div className="q-field"><span>Message</span><Textarea ref={bodyRef} rows={7} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="text-sm leading-relaxed" /></div>
          <div className="flex flex-wrap gap-1.5" aria-label="Insert a placeholder">{PLACEHOLDERS.map((k) => <button key={k} type="button" className="ph-chip" onClick={() => insert(k)}>{`{${k}}`}</button>)}</div>
          {unknown.length > 0 && <p role="alert" className="flex items-center gap-2 rounded-lg bg-warning-soft p-2.5 text-xs"><AlertTriangle className="size-4 shrink-0 text-warning" />Unsupported placeholder{unknown.length > 1 ? "s" : ""}: {unknown.join(", ")}. Use the Insert buttons instead — this template can't be saved until it's fixed.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={!dirty}>Save template</Button>
            {saved && !saved.isDefault && <Button variant="outline" onClick={() => { if (dirty && !window.confirm("Save is required first — discard unsaved changes and set the saved version as default?")) return; setDefaultTemplate(saved.id); setDraft({ ...saved, isDefault: true, enabled: true }); toast.success(`Default ${saved.purpose} template set`); }}><Star />Make default</Button>}
            {saved && <Button variant="outline" onClick={() => { const copy: WaTemplate = { ...saved, id: uid("tpl"), name: `${saved.name} (copy)`, isDefault: false, builtIn: false }; saveTemplate(copy); setSelId(copy.id); setDraft(copy); toast.success("Template duplicated"); }}><Copy />Duplicate</Button>}
            {saved && <Button variant="ghost" className="hover:text-destructive" onClick={() => { if (window.confirm(`Delete “${saved.name}”?`)) { deleteTemplate(saved.id); setSelId(null); setDraft(null); toast.success("Template deleted"); } }}><Trash2 />Delete</Button>}
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
          </div>
          <div className="wa-preview">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="eyebrow">Live preview with saved data</span>
              <select aria-label="Preview client" className={cn(selectCls, "h-8 text-xs")} value={previewLead} onChange={(e) => setPreviewLead(e.target.value)}>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            {preview ? <div className="wa-bubble">{preview}</div> : <p className="text-xs text-muted-foreground">Nothing to show — every sentence needs details this client doesn't have yet.</p>}
            <p className="text-[11px] text-muted-foreground">Sentences that need missing details are left out, so clients never see {"{placeholders}"}.</p>
          </div>
        </div>
      ) : (
        <div className="grid place-items-center rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">Choose a template, or add one with +.</div>
      )}
    </div>
  );
}
