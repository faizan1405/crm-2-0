import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Plus,
  Search,
  Copy,
  Pencil,
  Trash2,
  Eye,
  ArrowUp,
  ArrowDown,
  Share2,
  Printer,
  CheckCircle2,
  Clock,
  Layers,
  Sparkles,
} from "lucide-react";
import { PilotShell } from "./PilotShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { selectCls, Empty } from "@/components/crm/ShellPrimitives";
import {
  useDeleteQuotationTemplateMutation,
  useDuplicateQuotationTemplateMutation,
  useQuotationsQuery,
  useQuotationTemplatesQuery,
  useReorderQuotationTemplatesMutation,
  useUpdateQuotationTemplateMutation,
} from "@/lib/api/quotationsApi";
import type { QuotationDto, QuotationStatusApi, QuotationTemplateDto } from "@/lib/api/schemas";
import { formatINR, formatDate } from "@/lib/crm/format";
import { PilotQuotationTemplateModal } from "./PilotQuotationTemplateModal";
import { PilotNewQuotationDialog } from "./PilotNewQuotationDialog";
import { PilotQuotationDetailDrawer } from "./PilotQuotationDetailDrawer";

export function PilotSalesStudioPage({ search }: { search: Record<string, unknown> }) {
  const [activeTab, setActiveTab] = useState<"quotations" | "templates">("quotations");

  // Quotation search & filter
  const [quoteSearch, setQuoteSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuotationStatusApi | "all">("all");

  // Template search
  const [templateSearch, setTemplateSearch] = useState("");

  // Modals & Drawers
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<QuotationTemplateDto | null>(null);

  const [newQuotationOpen, setNewQuotationOpen] = useState(false);
  const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(null);

  // Queries
  const { data: templatesData, isLoading: templatesLoading } = useQuotationTemplatesQuery();
  const templates = templatesData?.items ?? [];

  const { data: quotesData, isLoading: quotesLoading } = useQuotationsQuery({
    q: quoteSearch.trim() || undefined,
    status: statusFilter,
  });
  const quotations = quotesData?.items ?? [];

  // Mutations
  const updateTemplateMutation = useUpdateQuotationTemplateMutation();
  const deleteTemplateMutation = useDeleteQuotationTemplateMutation();
  const duplicateTemplateMutation = useDuplicateQuotationTemplateMutation();
  const reorderTemplateMutation = useReorderQuotationTemplatesMutation();

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.sortOrder - b.sortOrder),
    [templates],
  );

  const filteredTemplates = useMemo(
    () =>
      sortedTemplates.filter((t) =>
        `${t.name} ${t.messageBody} ${t.priceLabel ?? ""} ${t.priceAmount ?? ""}`
          .toLowerCase()
          .includes(templateSearch.toLowerCase()),
      ),
    [sortedTemplates, templateSearch],
  );

  const handleMoveTemplate = async (templateId: string, direction: -1 | 1) => {
    const idx = sortedTemplates.findIndex((t) => t.id === templateId);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= sortedTemplates.length) return;

    const reordered = [...sortedTemplates];
    const [moved] = reordered.splice(idx, 1);
    if (!moved) return;
    reordered.splice(targetIdx, 0, moved);

    try {
      await reorderTemplateMutation.mutateAsync(reordered.map((t) => t.id));
      toast.success("Template order updated");
    } catch {
      toast.error("Failed to reorder templates");
    }
  };

  const handleDuplicateTemplate = async (id: string) => {
    try {
      await duplicateTemplateMutation.mutateAsync(id);
      toast.success("Package duplicated in MariaDB");
    } catch {
      toast.error("Failed to duplicate package");
    }
  };

  const handleDeleteTemplate = async (template: QuotationTemplateDto) => {
    if (!window.confirm(`Delete quotation package “${template.name}”? Past issued quotations remain unchanged.`)) return;
    try {
      await deleteTemplateMutation.mutateAsync(template.id);
      toast.success("Package deleted from MariaDB");
    } catch {
      toast.error("Failed to delete package");
    }
  };

  const handleToggleTemplateActive = async (template: QuotationTemplateDto, nextActive: boolean) => {
    try {
      await updateTemplateMutation.mutateAsync({
        id: template.id,
        payload: {
          isActive: nextActive,
          expectedVersion: template.version,
        },
      });
      toast.success(nextActive ? "Package marked active" : "Package marked inactive");
    } catch {
      toast.error("Failed to update status");
    }
  };

  const statusTones: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    sent: "bg-primary-soft text-primary",
    accepted: "bg-success-soft text-success",
    rejected: "bg-destructive-soft text-destructive",
  };

  return (
    <PilotShell
      title="Sales Studio (Pilot)"
      subtitle="MariaDB-backed quotation packages and structured proposals"
      actions={
        activeTab === "quotations" ? (
          <Button onClick={() => setNewQuotationOpen(true)}>
            <Plus className="size-4 mr-1.5" /> New Quotation
          </Button>
        ) : (
          <Button
            onClick={() => {
              setEditingTemplate(null);
              setTemplateModalOpen(true);
            }}
          >
            <Plus className="size-4 mr-1.5" /> Add Package
          </Button>
        )
      }
    >
      {/* Studio Tabs */}
      <div className="flex border-b mb-6 text-sm font-semibold gap-6">
        <button
          type="button"
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === "quotations"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("quotations")}
        >
          <FileText className="size-4" />
          Client Quotations
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground font-mono">
            {quotations.length}
          </span>
        </button>

        <button
          type="button"
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === "templates"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("templates")}
        >
          <Layers className="size-4" />
          Reusable Packages
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground font-mono">
            {templates.length}
          </span>
        </button>
      </div>

      {activeTab === "quotations" ? (
        <div className="grid gap-4">
          {/* Quotations Filter Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-2 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-8 text-xs"
                  placeholder="Search quotations by title, client, or number..."
                  value={quoteSearch}
                  onChange={(e) => setQuoteSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              {(["all", "draft", "sent", "accepted", "rejected"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                    statusFilter === st
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  }`}
                  onClick={() => setStatusFilter(st)}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Quotations Table */}
          {quotesLoading ? (
            <div className="py-16 text-center text-xs text-muted-foreground">Loading quotations from MariaDB...</div>
          ) : quotations.length === 0 ? (
            <div className="rounded-xl border bg-card p-12 text-center">
              <FileText className="mx-auto size-10 text-muted-foreground/60 mb-3" />
              <h3 className="text-sm font-semibold">No quotations found</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 mb-4">
                {quoteSearch || statusFilter !== "all"
                  ? "No client quotations match your active filter."
                  : "Create structured client proposals stored securely in MariaDB with exact integer-paise calculations."}
              </p>
              <Button onClick={() => setNewQuotationOpen(true)}>
                <Plus className="size-4 mr-1.5" /> Create First Quotation
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/40 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Number</th>
                      <th className="px-4 py-3">Proposal Title</th>
                      <th className="px-4 py-3">Client</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Investment</th>
                      <th className="px-4 py-3 text-right">Date</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {quotations.map((q) => (
                      <tr
                        key={q.id}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setSelectedQuotationId(q.id)}
                      >
                        <td className="px-4 py-3 font-mono font-bold text-foreground">
                          {q.quotationNumber}
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground max-w-xs truncate">
                          {q.title}
                          {q.items.length > 0 && (
                            <span className="block text-[11px] font-normal text-muted-foreground truncate">
                              {q.items.length} {q.items.length === 1 ? "deliverable" : "deliverables"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-foreground">{q.clientName}</div>
                          {q.clientCompany && (
                            <div className="text-[11px] text-muted-foreground truncate">{q.clientCompany}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTones[q.status] ?? "bg-muted"}`}>
                            {q.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-foreground text-sm">
                          {formatINR(q.totalAmount)}
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {q.issueIstDate}
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setSelectedQuotationId(q.id)}
                          >
                            <Eye className="size-3.5 mr-1" /> View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {/* Templates Search Toolbar */}
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8 text-xs"
                placeholder="Search packages by name, rate, or message..."
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Templates Cards Grid */}
          {templatesLoading ? (
            <div className="py-16 text-center text-xs text-muted-foreground">Loading templates from MariaDB...</div>
          ) : filteredTemplates.length === 0 ? (
            <div className="rounded-xl border bg-card p-12 text-center">
              <Layers className="mx-auto size-10 text-muted-foreground/60 mb-3" />
              <h3 className="text-sm font-semibold">No quotation packages found</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 mb-4">
                {templateSearch
                  ? "No packages match your search term."
                  : "Add standardized sales packages with preconfigured pricing and messages for fast proposal generation."}
              </p>
              <Button
                onClick={() => {
                  setEditingTemplate(null);
                  setTemplateModalOpen(true);
                }}
              >
                <Plus className="size-4 mr-1.5" /> Add Package
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTemplates.map((t, idx) => (
                <article
                  key={t.id}
                  className={`flex flex-col justify-between rounded-xl border bg-card p-4 shadow-sm transition-all ${
                    !t.isActive ? "opacity-60 bg-muted/20" : ""
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-sm text-foreground truncate" title={t.name}>
                          {t.name}
                        </h4>
                        <div className="font-mono font-bold text-base text-primary mt-0.5">
                          {t.priceType === "fixed" && t.priceAmount !== null
                            ? formatINR(t.priceAmount)
                            : t.priceLabel || "Custom"}
                        </div>
                      </div>
                      <Switch
                        aria-label={`Toggle active for ${t.name}`}
                        checked={t.isActive}
                        onCheckedChange={(checked) => handleToggleTemplateActive(t, checked)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed mb-4">
                      {t.messageBody}
                    </p>
                  </div>

                  <div className="border-t pt-3 flex items-center justify-between gap-1 text-xs text-muted-foreground">
                    <span className="text-[11px]">
                      {t.isActive ? "Active" : "Inactive"} · v{t.version}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        disabled={idx === 0}
                        onClick={() => handleMoveTemplate(t.id, -1)}
                        title="Move Up"
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        disabled={idx === filteredTemplates.length - 1}
                        onClick={() => handleMoveTemplate(t.id, 1)}
                        title="Move Down"
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => handleDuplicateTemplate(t.id)}
                        title="Duplicate"
                      >
                        <Copy className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 hover:text-destructive"
                        onClick={() => handleDeleteTemplate(t)}
                        title="Delete"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2 ml-1"
                        onClick={() => {
                          setEditingTemplate(t);
                          setTemplateModalOpen(true);
                        }}
                      >
                        <Pencil className="size-3 mr-1" /> Edit
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals & Drawers */}
      <PilotQuotationTemplateModal
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        template={editingTemplate}
      />

      <PilotNewQuotationDialog
        open={newQuotationOpen}
        onOpenChange={setNewQuotationOpen}
        onCreated={(id) => setSelectedQuotationId(id)}
      />

      <PilotQuotationDetailDrawer
        quotationId={selectedQuotationId}
        onClose={() => setSelectedQuotationId(null)}
      />
    </PilotShell>
  );
}
