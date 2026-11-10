import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest, createIdempotencyKey } from "./client";
import { leadKeys } from "./leadsApi";

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export const FIELD_TYPES_API = [
  "text",
  "longtext",
  "number",
  "currency",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "email",
  "phone",
] as const;
export type FieldTypeApi = (typeof FIELD_TYPES_API)[number];

export const TAG_COLORS_API = ["graphite", "green", "amber", "rose", "sky", "violet"] as const;
export type TagColorApi = (typeof TAG_COLORS_API)[number];

export const TAG_SCOPES_API = ["lead", "project", "both"] as const;
export type TagScopeApi = (typeof TAG_SCOPES_API)[number];

export const customFieldOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  archived: z.boolean().optional(),
});
export type CustomFieldOption = z.infer<typeof customFieldOptionSchema>;

export const customFieldHistorySchema = z.object({
  at: z.string(),
  change: z.string(),
});
export type CustomFieldHistory = z.infer<typeof customFieldHistorySchema>;

export const customFieldDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().optional(),
  entity: z.enum(["lead", "project"]),
  label: z.string(),
  type: z.enum(FIELD_TYPES_API),
  required: z.boolean(),
  highlight: z.boolean(),
  visibility: z.enum(["team", "owner"]),
  editable: z.enum(["team", "owner"]).optional(),
  description: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  options: z.array(customFieldOptionSchema),
  displayOrder: z.number().optional(),
  order: z.number().optional(),
  status: z.enum(["active", "archived"]),
  version: z.number(),
  history: z.array(customFieldHistorySchema).optional(),
  defaultValue: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomFieldDto = z.infer<typeof customFieldDtoSchema>;

export const customFieldsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(customFieldDtoSchema),
  total: z.number(),
});
export type CustomFieldsListResponse = z.infer<typeof customFieldsListResponseSchema>;

export const customFieldGetResponseSchema = z.object({
  ok: z.literal(true),
  field: customFieldDtoSchema,
});

export const leadCustomFieldsResponseSchema = z.object({
  ok: z.literal(true),
  leadId: z.string(),
  values: z.record(z.unknown()),
});
export type LeadCustomFieldsResponse = z.infer<typeof leadCustomFieldsResponseSchema>;

export const tagDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  color: z.enum(TAG_COLORS_API),
  scope: z.enum(TAG_SCOPES_API),
  status: z.enum(["active", "archived"]),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TagDto = z.infer<typeof tagDtoSchema>;

export const tagsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(tagDtoSchema),
  total: z.number(),
});
export type TagsListResponse = z.infer<typeof tagsListResponseSchema>;

export const tagGetResponseSchema = z.object({
  ok: z.literal(true),
  tag: tagDtoSchema,
});

export const leadTagsResponseSchema = z.object({
  ok: z.literal(true),
  leadId: z.string(),
  tags: z.array(tagDtoSchema),
});
export type LeadTagsResponse = z.infer<typeof leadTagsResponseSchema>;

export const bulkTagResponseSchema = z.object({
  ok: z.literal(true),
  tagId: z.string(),
  mode: z.enum(["add", "remove"]),
  changedCount: z.number(),
  affectedLeadIds: z.array(z.string()),
});
export type BulkTagResponse = z.infer<typeof bulkTagResponseSchema>;

export const viewConditionSchema = z.object({
  id: z.string(),
  field: z.string(),
  op: z.string(),
  value: z.unknown().optional(),
});
export type ViewConditionApi = z.infer<typeof viewConditionSchema>;

export const viewFilterSchema = z.object({
  mode: z.enum(["and", "or"]),
  conditions: z.array(viewConditionSchema),
});
export type ViewFilterApi = z.infer<typeof viewFilterSchema>;

export const savedViewDtoSchema = z.object({
  id: z.string(),
  ownerUserId: z.string().optional(),
  name: z.string(),
  visibility: z.enum(["personal", "company"]),
  sort: z.string(),
  filter: viewFilterSchema,
  columns: z.array(z.string()).optional(),
  archived: z.boolean(),
  isDefault: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  schemaVersion: z.number().optional(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedViewDto = z.infer<typeof savedViewDtoSchema>;

export const savedViewsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(savedViewDtoSchema),
  total: z.number(),
});
export type SavedViewsListResponse = z.infer<typeof savedViewsListResponseSchema>;

export const savedViewGetResponseSchema = z.object({
  ok: z.literal(true),
  view: savedViewDtoSchema,
});

// ============================================================================
// MUTATION INPUT TYPES
// ============================================================================

export interface CreateCustomFieldInput {
  id?: string;
  entity?: "lead" | "project";
  label: string;
  type: FieldTypeApi;
  required?: boolean;
  highlight?: boolean;
  visibility?: "team" | "owner";
  description?: string;
  currency?: string;
  options?: { id?: string; label: string; archived?: boolean }[];
  displayOrder?: number;
}

export interface UpdateCustomFieldInput {
  expectedVersion?: number;
  label?: string;
  type?: FieldTypeApi;
  required?: boolean;
  highlight?: boolean;
  visibility?: "team" | "owner";
  description?: string | null;
  currency?: string | null;
  options?: { id?: string; label: string; archived?: boolean }[];
  displayOrder?: number;
}

export interface CreateTagInput {
  id?: string;
  name: string;
  color?: TagColorApi;
  scope?: TagScopeApi;
}

export interface UpdateTagInput {
  expectedVersion?: number;
  name?: string;
  color?: TagColorApi;
  scope?: TagScopeApi;
}

export interface BulkTagLeadsInput {
  leadIds: string[];
  tagId: string;
  mode: "add" | "remove";
}

export interface CreateSavedViewInput {
  id?: string;
  name: string;
  visibility?: "personal" | "company";
  sort?: string;
  filter: ViewFilterApi;
}

export interface UpdateSavedViewInput {
  expectedVersion?: number;
  name?: string;
  visibility?: "personal" | "company";
  sort?: string;
  filter?: ViewFilterApi;
}

// ============================================================================
// QUERY KEYS
// ============================================================================

export const customizationKeys = {
  all: ["crm", "customizations"] as const,
  customFields: (entity?: "lead" | "project") =>
    [...customizationKeys.all, "fields", entity ?? "all"] as const,
  customField: (id: string) => [...customizationKeys.all, "field", id] as const,
  leadCustomFields: (leadId: string) => [...customizationKeys.all, "lead-fields", leadId] as const,
  tags: (scope?: TagScopeApi) => [...customizationKeys.all, "tags", scope ?? "all"] as const,
  tag: (id: string) => [...customizationKeys.all, "tag", id] as const,
  leadTags: (leadId: string) => [...customizationKeys.all, "lead-tags", leadId] as const,
  savedViews: (includeArchived?: boolean) =>
    [...customizationKeys.all, "saved-views", includeArchived ? "all" : "active"] as const,
  savedView: (id: string) => [...customizationKeys.all, "saved-view", id] as const,
};

// ============================================================================
// API CLIENT FUNCTIONS
// ============================================================================

// --- Custom Fields ---
export async function listCustomFields(
  entity: "lead" | "project" = "lead",
  signal?: AbortSignal,
): Promise<CustomFieldsListResponse> {
  return apiRequest({
    path: "/api/v1/custom-fields",
    method: "GET",
    query: { entity },
    schema: customFieldsListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getCustomField(id: string, signal?: AbortSignal): Promise<CustomFieldDto> {
  const res = await apiRequest({
    path: `/api/v1/custom-fields/${encodeURIComponent(id)}`,
    method: "GET",
    schema: customFieldGetResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.field;
}

export async function createCustomField(
  data: CreateCustomFieldInput,
  idempotencyKey: string = createIdempotencyKey(),
): Promise<CustomFieldDto> {
  const res = await apiRequest({
    path: "/api/v1/custom-fields",
    method: "POST",
    body: data,
    idempotencyKey,
    schema: customFieldGetResponseSchema,
  });
  return res.field;
}

export async function updateCustomField(
  id: string,
  data: UpdateCustomFieldInput,
): Promise<CustomFieldDto> {
  const res = await apiRequest({
    path: `/api/v1/custom-fields/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: data,
    schema: customFieldGetResponseSchema,
  });
  return res.field;
}

export async function archiveCustomField(
  id: string,
  expectedVersion?: number,
): Promise<CustomFieldDto> {
  const res = await apiRequest({
    path: `/api/v1/custom-fields/${encodeURIComponent(id)}`,
    method: "DELETE",
    ...(expectedVersion !== undefined ? { query: { expectedVersion } } : {}),
    schema: customFieldGetResponseSchema,
  });
  return res.field;
}

export async function getLeadCustomFields(
  leadId: string,
  signal?: AbortSignal,
): Promise<LeadCustomFieldsResponse> {
  return apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/custom-fields`,
    method: "GET",
    schema: leadCustomFieldsResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function setLeadCustomFields(
  leadId: string,
  values: Record<string, unknown>,
): Promise<LeadCustomFieldsResponse> {
  return apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/custom-fields`,
    method: "PUT",
    body: { values },
    schema: leadCustomFieldsResponseSchema,
  });
}

// --- Tags ---
export async function listTags(
  scope?: TagScopeApi,
  signal?: AbortSignal,
): Promise<TagsListResponse> {
  return apiRequest({
    path: "/api/v1/tags",
    method: "GET",
    query: { scope },
    schema: tagsListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getTag(id: string, signal?: AbortSignal): Promise<TagDto> {
  const res = await apiRequest({
    path: `/api/v1/tags/${encodeURIComponent(id)}`,
    method: "GET",
    schema: tagGetResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.tag;
}

export async function createTag(
  data: CreateTagInput,
  idempotencyKey: string = createIdempotencyKey(),
): Promise<TagDto> {
  const res = await apiRequest({
    path: "/api/v1/tags",
    method: "POST",
    body: data,
    idempotencyKey,
    schema: tagGetResponseSchema,
  });
  return res.tag;
}

export async function updateTag(id: string, data: UpdateTagInput): Promise<TagDto> {
  const res = await apiRequest({
    path: `/api/v1/tags/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: data,
    schema: tagGetResponseSchema,
  });
  return res.tag;
}

export async function archiveTag(id: string, expectedVersion?: number): Promise<TagDto> {
  const res = await apiRequest({
    path: `/api/v1/tags/${encodeURIComponent(id)}`,
    method: "DELETE",
    ...(expectedVersion !== undefined ? { query: { expectedVersion } } : {}),
    schema: tagGetResponseSchema,
  });
  return res.tag;
}

export async function getLeadTags(leadId: string, signal?: AbortSignal): Promise<LeadTagsResponse> {
  const res = await apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/tags`,
    method: "GET",
    schema: z.object({
      ok: z.literal(true),
      leadId: z.string(),
      tags: z.array(tagDtoSchema),
    }),
    ...(signal ? { signal } : {}),
  });
  return res;
}

export async function addTagToLead(
  leadId: string,
  tagId: string,
): Promise<{ ok: true; leadId: string; tagId: string; added: boolean }> {
  return apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/tags`,
    method: "POST",
    body: { tagId },
    schema: z.object({
      ok: z.literal(true),
      leadId: z.string(),
      tagId: z.string(),
      added: z.boolean(),
    }),
  });
}

export async function removeTagFromLead(
  leadId: string,
  tagId: string,
): Promise<{ ok: true; leadId: string; tagId: string; removed: boolean }> {
  return apiRequest({
    path: `/api/v1/leads/${encodeURIComponent(leadId)}/tags/${encodeURIComponent(tagId)}`,
    method: "DELETE",
    schema: z.object({
      ok: z.literal(true),
      leadId: z.string(),
      tagId: z.string(),
      removed: z.boolean(),
    }),
  });
}

export async function bulkTagLeads(data: BulkTagLeadsInput): Promise<BulkTagResponse> {
  return apiRequest({
    path: "/api/v1/leads/bulk-tag",
    method: "POST",
    body: data,
    schema: bulkTagResponseSchema,
  });
}

// --- Saved Views ---
export async function listSavedViews(
  includeArchived: boolean = false,
  signal?: AbortSignal,
): Promise<SavedViewsListResponse> {
  return apiRequest({
    path: "/api/v1/saved-views",
    method: "GET",
    query: { includeArchived },
    schema: savedViewsListResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getSavedView(id: string, signal?: AbortSignal): Promise<SavedViewDto> {
  const res = await apiRequest({
    path: `/api/v1/saved-views/${encodeURIComponent(id)}`,
    method: "GET",
    schema: savedViewGetResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return res.view;
}

export async function createSavedView(
  data: CreateSavedViewInput,
  idempotencyKey: string = createIdempotencyKey(),
): Promise<SavedViewDto> {
  const res = await apiRequest({
    path: "/api/v1/saved-views",
    method: "POST",
    body: data,
    idempotencyKey,
    schema: savedViewGetResponseSchema,
  });
  return res.view;
}

export async function updateSavedView(
  id: string,
  data: UpdateSavedViewInput,
): Promise<SavedViewDto> {
  const res = await apiRequest({
    path: `/api/v1/saved-views/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: data,
    schema: savedViewGetResponseSchema,
  });
  return res.view;
}

export async function archiveSavedView(
  id: string,
  expectedVersion?: number,
): Promise<SavedViewDto> {
  const res = await apiRequest({
    path: `/api/v1/saved-views/${encodeURIComponent(id)}`,
    method: "DELETE",
    ...(expectedVersion !== undefined ? { query: { expectedVersion } } : {}),
    schema: savedViewGetResponseSchema,
  });
  return res.view;
}

export async function duplicateSavedView(id: string): Promise<SavedViewDto> {
  const res = await apiRequest({
    path: `/api/v1/saved-views/${encodeURIComponent(id)}/duplicate`,
    method: "POST",
    schema: savedViewGetResponseSchema,
  });
  return res.view;
}

// ============================================================================
// REACT QUERY HOOKS
// ============================================================================

// --- Custom Fields Hooks ---
export function useCustomFieldsQuery(entity: "lead" | "project" = "lead") {
  return useQuery({
    queryKey: customizationKeys.customFields(entity),
    queryFn: ({ signal }) => listCustomFields(entity, signal),
    staleTime: 30_000,
  });
}

export function useLeadCustomFieldsQuery(leadId: string | undefined | null) {
  return useQuery({
    queryKey: customizationKeys.leadCustomFields(leadId ?? ""),
    queryFn: ({ signal }) => getLeadCustomFields(leadId!, signal),
    enabled: Boolean(leadId),
    staleTime: 10_000,
  });
}

export function useCreateCustomFieldMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCustomFieldInput) => createCustomField(data),
    onSuccess: (field) => {
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.customFields(field.entity),
      });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useUpdateCustomFieldMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCustomFieldInput }) =>
      updateCustomField(id, data),
    onSuccess: (field) => {
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.customFields(field.entity),
      });
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.customField(field.id),
      });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useArchiveCustomFieldMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion?: number }) =>
      archiveCustomField(id, expectedVersion),
    onSuccess: (field) => {
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.customFields(field.entity),
      });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useSetLeadCustomFieldsMutation(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => setLeadCustomFields(leadId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.leadCustomFields(leadId),
      });
      void queryClient.invalidateQueries({
        queryKey: leadKeys.detail(leadId),
      });
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
    },
  });
}

// --- Tags Hooks ---
export function useTagsQuery(scope?: TagScopeApi) {
  return useQuery({
    queryKey: customizationKeys.tags(scope),
    queryFn: ({ signal }) => listTags(scope, signal),
    staleTime: 30_000,
  });
}

export function useLeadTagsQuery(leadId: string | undefined | null) {
  return useQuery({
    queryKey: customizationKeys.leadTags(leadId ?? ""),
    queryFn: ({ signal }) => getLeadTags(leadId!, signal),
    enabled: Boolean(leadId),
    staleTime: 10_000,
  });
}

export function useCreateTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTagInput) => createTag(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customizationKeys.all });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useUpdateTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTagInput }) => updateTag(id, data),
    onSuccess: (tag) => {
      void queryClient.invalidateQueries({ queryKey: customizationKeys.all });
      void queryClient.invalidateQueries({ queryKey: customizationKeys.tag(tag.id) });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useArchiveTagMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion?: number }) =>
      archiveTag(id, expectedVersion),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customizationKeys.all });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useAddTagToLeadMutation(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) => addTagToLead(leadId, tagId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.leadTags(leadId),
      });
      void queryClient.invalidateQueries({
        queryKey: leadKeys.detail(leadId),
      });
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
    },
  });
}

export function useRemoveTagFromLeadMutation(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) => removeTagFromLead(leadId, tagId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.leadTags(leadId),
      });
      void queryClient.invalidateQueries({
        queryKey: leadKeys.detail(leadId),
      });
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists() });
    },
  });
}

export function useBulkTagLeadsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BulkTagLeadsInput) => bulkTagLeads(data),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
      for (const id of res.affectedLeadIds) {
        void queryClient.invalidateQueries({
          queryKey: customizationKeys.leadTags(id),
        });
        void queryClient.invalidateQueries({
          queryKey: leadKeys.detail(id),
        });
      }
    },
  });
}

// --- Saved Views Hooks ---
export function useSavedViewsQuery(includeArchived: boolean = false) {
  return useQuery({
    queryKey: customizationKeys.savedViews(includeArchived),
    queryFn: ({ signal }) => listSavedViews(includeArchived, signal),
    staleTime: 30_000,
  });
}

export function useSavedViewQuery(id: string | undefined | null) {
  return useQuery({
    queryKey: customizationKeys.savedView(id ?? ""),
    queryFn: ({ signal }) => getSavedView(id!, signal),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useCreateSavedViewMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSavedViewInput) => createSavedView(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.savedViews(),
      });
    },
  });
}

export function useUpdateSavedViewMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSavedViewInput }) =>
      updateSavedView(id, data),
    onSuccess: (view) => {
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.savedViews(),
      });
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.savedView(view.id),
      });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useArchiveSavedViewMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion?: number }) =>
      archiveSavedView(id, expectedVersion),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.savedViews(),
      });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

export function useDuplicateSavedViewMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => duplicateSavedView(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: customizationKeys.savedViews(),
      });
    },
  });
}
