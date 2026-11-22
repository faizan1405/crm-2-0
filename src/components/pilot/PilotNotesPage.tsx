import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditor, EditorContent, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import {
  AlertCircle,
  ArrowLeft,
  Bold,
  Check,
  FolderKanban,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Pilcrow,
  Pin,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  StickyNote,
  Tag,
  Trash2,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { PilotShell } from "./PilotShell";
import { Empty, selectCls } from "@/components/crm/ShellPrimitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useCreateNoteMutation,
  useDeleteNoteMutation,
  useNotesQuery,
  usePinNoteMutation,
  useUpdateNoteMutation,
  type NoteSortApi,
  type PersonalNoteDto,
} from "@/lib/api/notesApi";
import { useLeadsListQuery } from "@/lib/api/leadsApi";
import { useProjectsQuery } from "@/lib/api/projectsApi";
import { formatApiErrorMessage, isApiError } from "@/lib/api/errors";
import { pilotLinkSearch } from "@/lib/api/pilotHook";
import { relative } from "@/lib/crm/format";
import { checklistProgress, noteDoc } from "@/lib/crm/notes";
import type { NoteDoc } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

type SaveStatus = "idle" | "pending" | "saved" | "error";

interface DraftPayload {
  id: string;
  title: string;
  doc: NoteDoc;
  tags: string[];
  linkedLeadId: string | null;
  linkedProjectId: string | null;
}

export function PilotNotesPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<NoteSortApi>("recent");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const notesQuery = useNotesQuery({
    q: q.trim() || undefined,
    tag: tagFilter || undefined,
    pinned: pinnedOnly ? true : undefined,
    sort,
  });
  const leadsQuery = useLeadsListQuery({ lifecycle: "active", limit: 100 });
  const projectsQuery = useProjectsQuery({ limit: 100 });

  const createNote = useCreateNoteMutation();
  const updateNote = useUpdateNoteMutation();
  const pinNote = usePinNoteMutation();
  const deleteNote = useDeleteNoteMutation();

  const notes = useMemo(() => notesQuery.data?.items ?? [], [notesQuery.data?.items]);
  const leads = leadsQuery.data?.items ?? [];
  const projects = projectsQuery.data?.items ?? [];

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) {
      for (const t of n.tags) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [notes]);

  const [selId, setSelId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [linkedLeadId, setLinkedLeadId] = useState<string | null>(null);
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [conflictLatest, setConflictLatest] = useState<PersonalNoteDto | null>(null);

  const sel = useMemo(() => notes.find((n) => n.id === selId) ?? null, [notes, selId]);

  // Select first available note when list loads and nothing is selected
  useEffect(() => {
    if (!selId && notes.length > 0) {
      setSelId(notes[0]!.id);
    } else if (
      selId &&
      notes.length > 0 &&
      !notes.some((n) => n.id === selId) &&
      !q &&
      !tagFilter &&
      !pinnedOnly
    ) {
      setSelId(notes[0]!.id);
    }
  }, [notes, selId, q, tagFilter, pinnedOnly]);

  const selIdRef = useRef<string | null>(selId);
  selIdRef.current = selId;
  const versionRef = useRef<number>(1);
  const titleRef = useRef(title);
  titleRef.current = title;
  const tagsRef = useRef(tags);
  tagsRef.current = tags;
  const linkedLeadIdRef = useRef(linkedLeadId);
  linkedLeadIdRef.current = linkedLeadId;
  const linkedProjectIdRef = useRef(linkedProjectId);
  linkedProjectIdRef.current = linkedProjectId;
  const pendingDraftRef = useRef<DraftPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitDraft = useCallback(
    async (draft: DraftPayload, overrideVersion?: number): Promise<boolean> => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingDraftRef.current = null;
      setStatus("pending");
      try {
        const saved = await updateNote.mutateAsync({
          id: draft.id,
          expectedVersion: overrideVersion ?? versionRef.current,
          title: draft.title.trim() || "Untitled note",
          doc: draft.doc,
          tags: draft.tags,
          linkedLeadId: draft.linkedLeadId,
          linkedProjectId: draft.linkedProjectId,
        });
        if (selIdRef.current === saved.id) {
          versionRef.current = saved.version;
          setConflictLatest(null);
          setStatus("saved");
        }
        return true;
      } catch (err) {
        if (isApiError(err) && err.status === 409 && err.code === "stale_conflict") {
          const details = err.details as { latest?: PersonalNoteDto } | undefined;
          setConflictLatest(details?.latest ?? null);
          setStatus("error");
          return false;
        }
        setStatus("error");
        toast.error(formatApiErrorMessage(err));
        return false;
      }
    },
    [updateNote],
  );

  const scheduleDraft = useCallback(
    (draft: DraftPayload) => {
      pendingDraftRef.current = draft;
      setStatus("pending");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const next = pendingDraftRef.current;
        if (next) void commitDraft(next);
      }, 650);
    },
    [commitDraft],
  );

  const flushPending = useCallback(async (): Promise<boolean> => {
    if (conflictLatest) return false;
    const next = pendingDraftRef.current;
    if (!next) return true;
    return commitDraft(next);
  }, [commitDraft, conflictLatest]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        strike: false,
        horizontalRule: false,
        link: false,
        underline: false,
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
    ],
    editorProps: { attributes: { class: "note-prose", "aria-label": "Note content" } },
    onUpdate: ({ editor: e }) => {
      const id = selIdRef.current;
      if (!id) return;
      scheduleDraft({
        id,
        title: titleRef.current,
        doc: e.getJSON() as NoteDoc,
        tags: tagsRef.current,
        linkedLeadId: linkedLeadIdRef.current,
        linkedProjectId: linkedProjectIdRef.current,
      });
    },
  });

  // Load selected note into editor when selId changes
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingDraftRef.current = null;
    setConflictLatest(null);
    setStatus("idle");

    if (!sel) {
      setTitle("");
      setTags([]);
      setLinkedLeadId(null);
      setLinkedProjectId(null);
      return;
    }

    setTitle(sel.title);
    setTags(sel.tags);
    setLinkedLeadId(sel.linkedLeadId);
    setLinkedProjectId(sel.linkedProjectId);
    versionRef.current = sel.version;
    if (editor) {
      editor.commands.setContent(noteDoc(sel) as never, { emitUpdate: false });
    }
  }, [sel?.id, editor]);

  const handleSelect = async (id: string) => {
    if (id !== selId) {
      const ok = await flushPending();
      if (!ok) {
        toast.error("Resolve this note's unsaved changes before switching.");
        return;
      }
    }
    setSelId(id);
    setMobileOpen(true);
  };

  const handleCreate = async () => {
    const ok = await flushPending();
    if (!ok) {
      toast.error("Resolve this note's unsaved changes first.");
      return;
    }
    try {
      const created = await createNote.mutateAsync({
        title: "",
        doc: { type: "doc", content: [{ type: "paragraph" }] },
        tags: tagFilter ? [tagFilter] : [],
      });
      setQ("");
      setSelId(created.id);
      setMobileOpen(true);
      requestAnimationFrame(() => {
        const el = document.getElementById("note-title") as HTMLInputElement | null;
        el?.focus();
      });
    } catch (err) {
      toast.error(formatApiErrorMessage(err));
    }
  };

  const handleDelete = async (note: PersonalNoteDto) => {
    if (!window.confirm(`Delete "${note.title || "Untitled note"}"?`)) return;
    if (note.id === selId && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingDraftRef.current = null;
    }
    try {
      await deleteNote.mutateAsync(note.id);
      toast.success("Note deleted");
      if (note.id === selId) {
        const remaining = notes.filter((n) => n.id !== note.id);
        setSelId(remaining[0]?.id ?? null);
        setMobileOpen(false);
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err));
    }
  };

  const handleTogglePin = async (note: PersonalNoteDto) => {
    await flushPending();
    try {
      const updated = await pinNote.mutateAsync({
        id: note.id,
        pinned: !note.pinned,
        expectedVersion: note.id === selId ? versionRef.current : note.version,
      });
      if (updated.id === selId) {
        versionRef.current = updated.version;
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err));
    }
  };

  const addTag = () => {
    const clean = tagInput.trim().replace(/[<>]/g, "").slice(0, 32);
    if (!clean || !sel || !editor) return;
    if (tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setTagInput("");
      return;
    }
    if (tags.length >= 12) {
      toast.error("Maximum 12 tags per note.");
      return;
    }
    const nextTags = [...tags, clean];
    setTags(nextTags);
    setTagInput("");
    void commitDraft({
      id: sel.id,
      title: titleRef.current,
      doc: editor.getJSON() as NoteDoc,
      tags: nextTags,
      linkedLeadId: linkedLeadIdRef.current,
      linkedProjectId: linkedProjectIdRef.current,
    });
  };

  const removeTag = (tagToRemove: string) => {
    if (!sel || !editor) return;
    const nextTags = tags.filter((t) => t !== tagToRemove);
    setTags(nextTags);
    void commitDraft({
      id: sel.id,
      title: titleRef.current,
      doc: editor.getJSON() as NoteDoc,
      tags: nextTags,
      linkedLeadId: linkedLeadIdRef.current,
      linkedProjectId: linkedProjectIdRef.current,
    });
  };

  const updateLinkedLead = (nextLeadId: string) => {
    if (!sel || !editor) return;
    const val = nextLeadId || null;
    setLinkedLeadId(val);
    void commitDraft({
      id: sel.id,
      title: titleRef.current,
      doc: editor.getJSON() as NoteDoc,
      tags: tagsRef.current,
      linkedLeadId: val,
      linkedProjectId: linkedProjectIdRef.current,
    });
  };

  const updateLinkedProject = (nextProjectId: string) => {
    if (!sel || !editor) return;
    const val = nextProjectId || null;
    setLinkedProjectId(val);
    void commitDraft({
      id: sel.id,
      title: titleRef.current,
      doc: editor.getJSON() as NoteDoc,
      tags: tagsRef.current,
      linkedLeadId: linkedLeadIdRef.current,
      linkedProjectId: val,
    });
  };

  const loadLatestConflict = () => {
    if (!conflictLatest || !editor) return;
    versionRef.current = conflictLatest.version;
    setTitle(conflictLatest.title);
    setTags(conflictLatest.tags);
    setLinkedLeadId(conflictLatest.linkedLeadId);
    setLinkedProjectId(conflictLatest.linkedProjectId);
    editor.commands.setContent(noteDoc(conflictLatest) as never, { emitUpdate: false });
    setConflictLatest(null);
    setStatus("idle");
    toast("Loaded the latest saved note");
  };

  const keepMineConflict = async () => {
    if (!sel || !conflictLatest || !editor) return;
    if (!window.confirm("Replace the newer saved version with your draft?")) return;
    const ok = await commitDraft(
      {
        id: sel.id,
        title: titleRef.current,
        doc: editor.getJSON() as NoteDoc,
        tags: tagsRef.current,
        linkedLeadId: linkedLeadIdRef.current,
        linkedProjectId: linkedProjectIdRef.current,
      },
      conflictLatest.version,
    );
    if (ok) toast.success("Your draft replaced the previous version");
  };

  const saveAsCopyConflict = async () => {
    if (!editor) return;
    try {
      const copy = await createNote.mutateAsync({
        title: `${titleRef.current.trim() || "Untitled note"} (my draft)`,
        doc: editor.getJSON() as NoteDoc,
        tags: tagsRef.current,
        linkedLeadId: linkedLeadIdRef.current,
        linkedProjectId: linkedProjectIdRef.current,
      });
      setConflictLatest(null);
      setStatus("saved");
      setSelId(copy.id);
      toast.success("Draft saved as a new note");
    } catch (err) {
      toast.error(formatApiErrorMessage(err));
    }
  };

  return (
    <PilotShell
      title="Personal Notes"
      subtitle={`${notes.length} ${notes.length === 1 ? "note" : "notes"} · private to your Owner account`}
      actions={
        <Button
          onClick={() => void handleCreate()}
          disabled={createNote.isPending}
          className="rounded-full"
        >
          {createNote.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          New note
        </Button>
      }
    >
      <div className="notes-ws">
        <aside
          className={cn("notes-lib", mobileOpen && "max-lg:hidden")}
          aria-label="Notes library"
        >
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search titles, text, tags"
              aria-label="Search notes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {notes.length} {notes.length === 1 ? "note" : "notes"}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={pinnedOnly ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setPinnedOnly((p) => !p)}
              >
                <Pin className={cn("mr-1 size-3", pinnedOnly && "fill-current")} />
                Pinned
              </Button>
              <select
                aria-label="Sort notes"
                className={cn(selectCls, "h-8 text-xs")}
                value={sort}
                onChange={(e) => setSort(e.target.value as NoteSortApi)}
              >
                <option value="recent">Recently edited</option>
                <option value="created">Newest first</option>
                <option value="title">Title A–Z</option>
              </select>
            </div>
          </div>

          {allTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1" aria-label="Filter by tag">
              {tagFilter && (
                <button
                  type="button"
                  onClick={() => setTagFilter("")}
                  className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground"
                >
                  #{tagFilter}
                  <X className="size-3" />
                </button>
              )}
              {allTags
                .filter((t) => t !== tagFilter)
                .slice(0, 8)
                .map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTagFilter(t)}
                    className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    #{t}
                  </button>
                ))}
            </div>
          )}

          {notesQuery.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading notes…
            </div>
          ) : notesQuery.isError ? (
            <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <p className="font-medium text-destructive">Failed to load notes</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void notesQuery.refetch()}
              >
                <RefreshCw className="mr-1.5 size-3" />
                Retry
              </Button>
            </div>
          ) : notes.length === 0 ? (
            <Empty
              icon={<StickyNote />}
              title={q || tagFilter || pinnedOnly ? "No notes match" : "No notes yet"}
              {...(!q && !tagFilter && !pinnedOnly
                ? {
                    action: (
                      <Button size="sm" onClick={() => void handleCreate()}>
                        <Plus className="size-4" />
                        New note
                      </Button>
                    ),
                  }
                : {})}
            />
          ) : (
            <ul className="mt-3 grid gap-1.5">
              {notes.map((n) => {
                const pr = checklistProgress(noteDoc(n));
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => void handleSelect(n.id)}
                      aria-current={n.id === selId ? "true" : undefined}
                      className="notes-item"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">
                          {n.title || "Untitled note"}
                        </span>
                        {n.pinned && (
                          <Pin
                            className="size-3 shrink-0 fill-current text-foreground"
                            aria-label="Pinned"
                          />
                        )}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {n.body.trim() || "Empty note"}
                      </span>
                      {(n.tags.length > 0 || n.linkedLeadName || n.linkedProjectName) && (
                        <span className="flex flex-wrap gap-1 pt-0.5">
                          {n.linkedLeadName && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                              <UserRound className="size-2.5" />
                              {n.linkedLeadName}
                            </span>
                          )}
                          {n.linkedProjectName && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                              <FolderKanban className="size-2.5" />
                              {n.linkedProjectName}
                            </span>
                          )}
                          {n.tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="rounded bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              #{t}
                            </span>
                          ))}
                        </span>
                      )}
                      <span className="flex gap-2 text-[10px] text-muted-foreground">
                        <span>Edited {relative(n.updatedAt)}</span>
                        {pr.total > 0 && (
                          <span className="num">
                            ☑ {pr.done}/{pr.total}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section
          className={cn("notes-pane", !mobileOpen && "max-lg:hidden")}
          aria-label="Note editor"
        >
          {!sel ? (
            <Empty icon={<StickyNote />} title="Select or create a note" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="lg:hidden"
                  onClick={() => {
                    void flushPending();
                    setMobileOpen(false);
                  }}
                >
                  <ArrowLeft className="size-4" />
                  Notes
                </Button>
                {conflictLatest ? (
                  <span className="notes-save text-destructive" role="status">
                    <AlertCircle className="size-3" />
                    Not saved — version conflict
                  </span>
                ) : (
                  <SaveBadge
                    status={status}
                    onRetry={() => {
                      if (editor && sel) {
                        void commitDraft({
                          id: sel.id,
                          title: titleRef.current,
                          doc: editor.getJSON() as NoteDoc,
                          tags: tagsRef.current,
                          linkedLeadId: linkedLeadIdRef.current,
                          linkedProjectId: linkedProjectIdRef.current,
                        });
                      }
                    }}
                  />
                )}
                <div className="ml-auto flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={sel.pinned ? "Unpin note" : "Pin note"}
                    aria-pressed={sel.pinned}
                    onClick={() => void handleTogglePin(sel)}
                  >
                    <Pin className={cn("size-4", sel.pinned && "fill-current")} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete note"
                    className="hover:text-destructive"
                    onClick={() => void handleDelete(sel)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              {conflictLatest && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
                >
                  <p className="font-medium">
                    This note has newer changes saved elsewhere. Your draft has been preserved.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nothing was overwritten. Choose how to resolve:
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void saveAsCopyConflict()}>
                      Save my draft as a new note
                    </Button>
                    <Button size="sm" variant="outline" onClick={loadLatestConflict}>
                      Load latest (discard draft)
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void keepMineConflict()}>
                      Replace with my draft
                    </Button>
                  </div>
                </div>
              )}

              <input
                id="note-title"
                aria-label="Note title"
                className="notes-title"
                value={title}
                placeholder="Untitled note"
                onChange={(e) => {
                  const nextTitle = e.target.value;
                  setTitle(nextTitle);
                  if (editor) {
                    scheduleDraft({
                      id: sel.id,
                      title: nextTitle,
                      doc: editor.getJSON() as NoteDoc,
                      tags: tagsRef.current,
                      linkedLeadId: linkedLeadIdRef.current,
                      linkedProjectId: linkedProjectIdRef.current,
                    });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    editor?.commands.focus("start");
                  }
                }}
              />

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>Created {relative(sel.createdAt)}</span>
                <span>·</span>
                <span>v{sel.version}</span>
                {sel.linkedLeadId && sel.linkedLeadName && (
                  <Link
                    to="/leads/$id"
                    params={{ id: sel.linkedLeadId }}
                    search={pilotLinkSearch()}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-foreground hover:bg-muted"
                  >
                    <UserRound className="size-3" />
                    {sel.linkedLeadName}
                  </Link>
                )}
                {sel.linkedProjectId && sel.linkedProjectName && (
                  <Link
                    to="/projects/$id"
                    params={{ id: sel.linkedProjectId }}
                    search={pilotLinkSearch()}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-foreground hover:bg-muted"
                  >
                    <FolderKanban className="size-3" />
                    {sel.linkedProjectName}
                  </Link>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <UserRound className="size-3.5 text-muted-foreground" />
                  <select
                    aria-label="Link lead"
                    className={cn(selectCls, "h-7 max-w-[180px] text-xs")}
                    value={linkedLeadId ?? ""}
                    onChange={(e) => updateLinkedLead(e.target.value)}
                  >
                    <option value="">No linked lead</option>
                    {leads.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <FolderKanban className="size-3.5 text-muted-foreground" />
                  <select
                    aria-label="Link project"
                    className={cn(selectCls, "h-7 max-w-[180px] text-xs")}
                    value={linkedProjectId ?? ""}
                    onChange={(e) => updateLinkedProject(e.target.value)}
                  >
                    <option value="">No linked project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-1 flex-wrap items-center gap-1">
                  <Tag className="size-3.5 text-muted-foreground" />
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px]"
                    >
                      #{t}
                      <button
                        type="button"
                        aria-label={`Remove tag ${t}`}
                        onClick={() => removeTag(t)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-2.5" />
                      </button>
                    </span>
                  ))}
                  <input
                    aria-label="Add tag"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="Add tag…"
                    className="h-7 w-24 rounded border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              {editor && <Toolbar editor={editor} />}
              <EditorContent editor={editor} className="notes-body" />
            </>
          )}
        </section>
      </div>
    </PilotShell>
  );
}

function SaveBadge({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === "pending") {
    return (
      <span className="notes-save" role="status">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="notes-save" role="status">
        <Check className="size-3 text-success" />
        Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="notes-save text-destructive" role="alert">
        <AlertCircle className="size-3" />
        Not saved —{" "}
        <button type="button" className="underline" onClick={onRetry}>
          Retry
        </button>
      </span>
    );
  }
  return (
    <span className="notes-save" role="status">
      Changes save automatically
    </span>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  });
  const items: {
    label: string;
    keys: string;
    icon: React.ReactNode;
    on?: boolean;
    disabled?: boolean;
    run: () => void;
  }[] = [
    {
      label: "Normal text",
      keys: "",
      icon: <Pilcrow />,
      on: !s.bullet && !s.ordered && !s.task,
      run: () => editor.chain().focus().clearNodes().run(),
    },
    {
      label: "Bold",
      keys: "Ctrl+B",
      icon: <Bold />,
      on: s.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      keys: "Ctrl+I",
      icon: <Italic />,
      on: s.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Bullet list",
      keys: "Ctrl+Shift+8",
      icon: <List />,
      on: s.bullet,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      keys: "Ctrl+Shift+7",
      icon: <ListOrdered />,
      on: s.ordered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Checklist",
      keys: "Ctrl+Shift+9",
      icon: <ListChecks />,
      on: s.task,
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: "Undo",
      keys: "Ctrl+Z",
      icon: <Undo2 />,
      disabled: !s.undo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "Redo",
      keys: "Ctrl+Shift+Z",
      icon: <Redo2 />,
      disabled: !s.redo,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <TooltipProvider delayDuration={300}>
      <div className="notes-toolbar" role="toolbar" aria-label="Formatting">
        {items.map((it, i) => (
          <Tooltip key={it.label}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={it.label}
                aria-pressed={it.on ?? undefined}
                disabled={it.disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={it.run}
                className={cn(i === 6 && "ml-auto")}
              >
                {it.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {it.label}
              {it.keys && <span className="ml-2 opacity-60">{it.keys}</span>}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
