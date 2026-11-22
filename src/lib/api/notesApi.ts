import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { NoteDoc } from "@/lib/crm/types";
import { apiRequest } from "./client";

export const NOTE_COLORS_API = ["default", "amber", "blue", "green", "rose"] as const;
export type NoteColorApi = (typeof NOTE_COLORS_API)[number];

export const NOTE_SORTS_API = ["recent", "created", "title"] as const;
export type NoteSortApi = (typeof NOTE_SORTS_API)[number];

const personalNoteDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  doc: z.record(z.string(), z.unknown()) as unknown as z.ZodType<NoteDoc>,
  tags: z.array(z.string()),
  color: z.enum(NOTE_COLORS_API),
  pinned: z.boolean(),
  linkedLeadId: z.string().nullable(),
  linkedLeadName: z.string().nullable(),
  linkedProjectId: z.string().nullable(),
  linkedProjectName: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PersonalNoteDto = z.infer<typeof personalNoteDtoSchema>;

const listNotesResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(personalNoteDtoSchema),
  total: z.number().int().nonnegative(),
});

const singleNoteResponseSchema = z.object({
  ok: z.literal(true),
  note: personalNoteDtoSchema,
});

const deleteNoteResponseSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  deleted: z.literal(true),
  archivedAt: z.string(),
});

export interface ListNotesQueryParams {
  q?: string | undefined;
  tag?: string | undefined;
  pinned?: boolean | undefined;
  leadId?: string | undefined;
  projectId?: string | undefined;
  sort?: NoteSortApi | undefined;
  limit?: number | undefined;
}

export interface CreateNotePayload {
  title?: string;
  body?: string;
  doc?: NoteDoc;
  tags?: string[];
  color?: NoteColorApi | null;
  pinned?: boolean;
  linkedLeadId?: string | null;
  linkedProjectId?: string | null;
}

export interface UpdateNotePayload {
  id: string;
  expectedVersion: number;
  title?: string;
  body?: string;
  doc?: NoteDoc;
  tags?: string[];
  color?: NoteColorApi | null;
  pinned?: boolean;
  linkedLeadId?: string | null;
  linkedProjectId?: string | null;
}

export const notesKeys = {
  all: ["pilot-notes"] as const,
  list: (params: ListNotesQueryParams = {}) => ["pilot-notes", "list", params] as const,
  detail: (id: string) => ["pilot-notes", "detail", id] as const,
};

export async function listNotesApi(params: ListNotesQueryParams = {}) {
  return apiRequest({
    path: "/api/v1/notes",
    method: "GET",
    query: {
      q: params.q,
      tag: params.tag,
      pinned: params.pinned,
      leadId: params.leadId,
      projectId: params.projectId,
      sort: params.sort,
      limit: params.limit,
    },
    schema: listNotesResponseSchema,
  });
}

export async function getNoteApi(id: string) {
  const res = await apiRequest({
    path: `/api/v1/notes/${encodeURIComponent(id)}`,
    method: "GET",
    schema: singleNoteResponseSchema,
  });
  return res.note;
}

export async function createNoteApi(payload: CreateNotePayload) {
  const res = await apiRequest({
    path: "/api/v1/notes",
    method: "POST",
    body: payload,
    schema: singleNoteResponseSchema,
  });
  return res.note;
}

export async function updateNoteApi(payload: UpdateNotePayload) {
  const { id, ...body } = payload;
  const res = await apiRequest({
    path: `/api/v1/notes/${encodeURIComponent(id)}`,
    method: "PATCH",
    body,
    schema: singleNoteResponseSchema,
  });
  return res.note;
}

export async function pinNoteApi(id: string, pinned: boolean, expectedVersion?: number) {
  const res = await apiRequest({
    path: `/api/v1/notes/${encodeURIComponent(id)}/pin`,
    method: "POST",
    body: { pinned, ...(expectedVersion !== undefined ? { expectedVersion } : {}) },
    schema: singleNoteResponseSchema,
  });
  return res.note;
}

export async function deleteNoteApi(id: string) {
  return apiRequest({
    path: `/api/v1/notes/${encodeURIComponent(id)}`,
    method: "DELETE",
    schema: deleteNoteResponseSchema,
  });
}

export function useNotesQuery(params: ListNotesQueryParams = {}) {
  return useQuery({
    queryKey: notesKeys.list(params),
    queryFn: () => listNotesApi(params),
    staleTime: 15_000,
  });
}

export function useCreateNoteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createNoteApi,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notesKeys.all });
    },
  });
}

export function useUpdateNoteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateNoteApi,
    onSuccess: (note) => {
      qc.setQueryData(notesKeys.detail(note.id), note);
      void qc.invalidateQueries({ queryKey: notesKeys.all });
    },
  });
}

export function usePinNoteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      pinned,
      expectedVersion,
    }: {
      id: string;
      pinned: boolean;
      expectedVersion?: number;
    }) => pinNoteApi(id, pinned, expectedVersion),
    onSuccess: (note) => {
      qc.setQueryData(notesKeys.detail(note.id), note);
      void qc.invalidateQueries({ queryKey: notesKeys.all });
    },
  });
}

export function useDeleteNoteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteNoteApi,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notesKeys.all });
    },
  });
}
