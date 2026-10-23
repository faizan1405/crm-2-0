import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileText, LayoutTemplate, MessagesSquare } from "lucide-react";
import { Shell } from "@/components/crm/Shell";
import { useCRM } from "@/lib/crm/store";
import { QuotationsPanel } from "@/components/studio/QuotationsPanel";
import { TemplatesPanel } from "@/components/studio/TemplatesPanel";
import { DemosPanel } from "@/components/studio/DemosPanel";

type Tab = "quotations" | "templates" | "demos";
const TABS: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: "quotations", label: "Quotations", icon: FileText },
  { key: "templates", label: "WhatsApp Templates", icon: MessagesSquare },
  { key: "demos", label: "Demo Library", icon: LayoutTemplate },
];
interface StudioSearch { tab?: Tab | undefined; client?: string | undefined }

export const Route = createFileRoute("/sales-studio")({
  validateSearch: (s: Record<string, unknown>): StudioSearch => ({
    ...(s["tab"] === "templates" || s["tab"] === "demos" || s["tab"] === "quotations" ? { tab: s["tab"] } : {}),
    ...(typeof s["client"] === "string" ? { client: s["client"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Sales Studio · Scale Flow CRM" },
      { name: "description", content: "Reusable quotation packages, WhatsApp templates and website demos managed in one place." },
      { property: "og:title", content: "Sales Studio · Scale Flow CRM" },
      { property: "og:description", content: "Reusable quotation packages, WhatsApp templates and website demos managed in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SalesStudio,
});

function SalesStudio() {
  const { tab = "quotations", client } = Route.useSearch();
  const navigate = useNavigate({ from: "/sales-studio" });
  const { quotationTemplates, waTemplates, demos } = useCRM();
  const go = (patch: StudioSearch) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true });
  const counts: Record<Tab, number> = { quotations: quotationTemplates.length, templates: waTemplates.length, demos: demos.length };
  return (
    <Shell title="Sales Studio" subtitle="One place for quotation packages, message templates and demo links — used by every WhatsApp message in the CRM">
      <div role="tablist" aria-label="Sales Studio areas" className="fu-tabs mb-5">
        {TABS.map((t) => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="fu-tab" onClick={() => go({ tab: t.key })}><t.icon className="size-4" />{t.label}<span className="fu-count num">{counts[t.key]}</span></button>)}
      </div>
      <div role="tabpanel" className="studio-pane" key={tab}>
        {tab === "quotations" && <QuotationsPanel client={client} />}
        {tab === "templates" && <TemplatesPanel />}
        {tab === "demos" && <DemosPanel />}
      </div>
      <p className="mt-8 text-[11px] text-muted-foreground">Saved on this device only for now. Changes appear instantly across the CRM and in other open tabs of this browser.</p>
    </Shell>
  );
}
