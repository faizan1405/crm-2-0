import "@tanstack/react-start/server-only";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { CrmDatabase } from "../db/index.server";
import {
  crmDeals,
  crmLeads,
  crmQuotationAuditEvents,
  crmQuotationItems,
  crmQuotationMilestones,
  crmQuotationRevisions,
  crmQuotationTemplates,
  crmQuotations,
} from "../db/schema.server";
import { generateServerId } from "../auth/security.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import { toIstParts } from "./dates.server";
import { CrmServiceError, isMysqlDuplicateKeyError } from "./errors.server";
import {
  hashIdempotentRequest,
  runWithIdempotency,
  type CrmTransaction,
} from "./idempotency.server";
import {
  calculateQuotationFinancials,
  type QuotationDiscountType,
  type QuotationLineItemInput,
  type QuotationMilestoneInput,
  type QuotationStatus,
} from "./quotationCalc.server";
import { parseStrictInrInputToPaise } from "../db/money.server";

function safeCalculateFinancials(input: Parameters<typeof calculateQuotationFinancials>[0]) {
  try {
    return calculateQuotationFinancials(input);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Financial calculation error.";
    throw new CrmServiceError(400, "validation_error", msg);
  }
}

// ---------------------------------------------------------------------------
// Template Types & DTOs
// ---------------------------------------------------------------------------

export interface CreateQuotationTemplateInput {
  name: string;
  priceType?: "fixed" | "custom" | undefined;
  priceAmount?: number | string | undefined;
  priceLabel?: string | undefined;
  currency?: "INR" | undefined;
  messageBody: string;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

export interface UpdateQuotationTemplateInput {
  name?: string | undefined;
  priceType?: "fixed" | "custom" | undefined;
  priceAmount?: number | string | undefined;
  priceLabel?: string | null | undefined;
  currency?: "INR" | undefined;
  messageBody?: string | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
  expectedVersion?: number | undefined;
}

export interface QuotationTemplateDto {
  id: string;
  ownerUserId: string;
  name: string;
  priceType: "fixed" | "custom";
  priceAmount: number | null;
  priceAmountDecimal: string | null;
  priceAmountPaise: number | null;
  priceLabel: string | null;
  currency: "INR";
  messageBody: string;
  isActive: boolean;
  sortOrder: number;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Client Quotation Types & DTOs
// ---------------------------------------------------------------------------

export interface CreateQuotationInput {
  leadId?: string | null | undefined;
  dealId?: string | null | undefined;
  templateId?: string | null | undefined;
  legacyId?: string | null | undefined;
  quotationNumber?: string | undefined;
  title: string;
  clientName: string;
  clientCompany?: string | null | undefined;
  currency?: "INR" | undefined;
  items?: readonly QuotationLineItemInput[] | undefined;
  packagePrice?: number | string | undefined;
  discountType?: QuotationDiscountType | undefined;
  discountValue?: number | string | undefined;
  gstEnabled?: boolean | undefined;
  gstRate?: number | string | undefined;
  milestones?: readonly QuotationMilestoneInput[] | undefined;
  status?: QuotationStatus | undefined;
  issueIstDate?: string | undefined;
  validUntilIstDate?: string | null | undefined;
  paymentTerms?: string | null | undefined;
  notes?: string | null | undefined;
  messageBody?: string | null | undefined;
  userConfirmedSent?: boolean | undefined;
}

export interface UpdateQuotationInput {
  title?: string | undefined;
  clientName?: string | undefined;
  clientCompany?: string | null | undefined;
  items?: readonly QuotationLineItemInput[] | undefined;
  packagePrice?: number | string | undefined;
  discountType?: QuotationDiscountType | undefined;
  discountValue?: number | string | undefined;
  gstEnabled?: boolean | undefined;
  gstRate?: number | string | undefined;
  milestones?: readonly QuotationMilestoneInput[] | undefined;
  validUntilIstDate?: string | null | undefined;
  paymentTerms?: string | null | undefined;
  notes?: string | null | undefined;
  messageBody?: string | null | undefined;
  changeSummary?: string | null | undefined;
  expectedVersion?: number | undefined;
}

export interface QuotationItemDto {
  id: string;
  quotationId: string;
  description: string;
  quantity: number;
  quantityDecimal: string;
  unitPrice: number;
  unitPriceDecimal: string;
  totalAmount: number;
  totalAmountDecimal: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationMilestoneDto {
  id: string;
  quotationId: string;
  label: string;
  percentage: number;
  percentageDecimal: string;
  amount: number;
  amountDecimal: string;
  dueDate: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface QuotationRevisionDto {
  id: string;
  quotationId: string;
  revisionNumber: number;
  snapshot: Record<string, unknown>;
  changeSummary: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface QuotationAuditEventDto {
  id: string;
  quotationId: string;
  ownerUserId: string;
  actorUserId: string;
  eventType: string;
  summary: string;
  details: Record<string, unknown> | null;
  occurredIstDate: string;
  createdAt: string;
}

export interface QuotationDto {
  id: string;
  ownerUserId: string;
  leadId: string | null;
  dealId: string | null;
  templateId: string | null;
  legacyId: string | null;
  quotationNumber: string;
  title: string;
  clientName: string;
  clientCompany: string | null;
  currency: "INR";
  subtotal: number;
  subtotalDecimal: string;
  discountType: QuotationDiscountType;
  discountValue: number;
  discountValueDecimal: string;
  discountAmount: number;
  discountAmountDecimal: string;
  taxableAmount: number;
  taxableAmountDecimal: string;
  gstEnabled: boolean;
  gstRate: number;
  gstRateDecimal: string;
  gstAmount: number;
  gstAmountDecimal: string;
  totalAmount: number;
  totalAmountDecimal: string;
  status: QuotationStatus;
  issueIstDate: string;
  validUntilIstDate: string | null;
  paymentTerms: string | null;
  notes: string | null;
  messageBody: string | null;
  userConfirmedSent: boolean;
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: QuotationItemDto[];
  milestones: QuotationMilestoneDto[];
}

export interface ListQuotationsFilters {
  leadId?: string | undefined;
  dealId?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  includeArchived?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Template Implementation
// ---------------------------------------------------------------------------

export async function createQuotationTemplateRecord(
  db: CrmDatabase,
  ownerUserId: string,
  input: CreateQuotationTemplateInput,
  options?: { now?: Date | undefined },
): Promise<QuotationTemplateDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);
  const name = input.name.trim();
  if (!name) throw new CrmServiceError(400, "validation_error", "Package name is required.");

  const priceType = input.priceType ?? "fixed";
  let priceAmountStr: string | null = null;

  if (priceType === "fixed") {
    if (input.priceAmount === undefined || input.priceAmount === null) {
      throw new CrmServiceError(400, "validation_error", "Price amount is required for fixed price packages.");
    }
    const parse = parseStrictInrInputToPaise(input.priceAmount, { allowZero: false });
    if (!parse.ok) throw new CrmServiceError(400, "validation_error", parse.message);
    priceAmountStr = parse.decimal;
  }

  const id = generateServerId("qtpl");
  let sortOrder = input.sortOrder ?? 0;
  if (input.sortOrder === undefined) {
    const [maxOrder] = await db
      .select({ max: sql<number>`COALESCE(MAX(${crmQuotationTemplates.sortOrder}), -1)` })
      .from(crmQuotationTemplates)
      .where(eq(crmQuotationTemplates.ownerUserId, ownerUserId));
    sortOrder = (maxOrder?.max ?? -1) + 1;
  }

  await db.insert(crmQuotationTemplates).values({
    id,
    ownerUserId,
    name,
    priceType,
    priceAmount: priceAmountStr,
    priceLabel: priceType === "custom" ? (input.priceLabel?.trim() || "On request") : null,
    currency: "INR",
    messageBody: input.messageBody.trim(),
    isActive: input.isActive ?? true,
    sortOrder,
    version: 1,
    archivedAt: null,
    createdAt: nowUtc,
    updatedAt: nowUtc,
  });

  const [row] = await db
    .select()
    .from(crmQuotationTemplates)
    .where(and(eq(crmQuotationTemplates.id, id), eq(crmQuotationTemplates.ownerUserId, ownerUserId)));

  if (!row) throw new CrmServiceError(500, "crm_unavailable", "Failed to retrieve created quotation template.");
  return toTemplateDto(row);
}

export async function listQuotationTemplatesRecords(
  db: CrmDatabase,
  ownerUserId: string,
  options?: { includeArchived?: boolean },
): Promise<QuotationTemplateDto[]> {
  const includeArchived = options?.includeArchived ?? false;
  const conditions = [eq(crmQuotationTemplates.ownerUserId, ownerUserId)];
  if (!includeArchived) {
    conditions.push(isNull(crmQuotationTemplates.archivedAt));
  }

  const rows = await db
    .select()
    .from(crmQuotationTemplates)
    .where(and(...conditions))
    .orderBy(crmQuotationTemplates.sortOrder, crmQuotationTemplates.createdAt);

  return rows.map(toTemplateDto);
}

export async function getQuotationTemplateRecord(
  db: CrmDatabase,
  ownerUserId: string,
  id: string,
): Promise<QuotationTemplateDto | null> {
  const [row] = await db
    .select()
    .from(crmQuotationTemplates)
    .where(and(eq(crmQuotationTemplates.id, id), eq(crmQuotationTemplates.ownerUserId, ownerUserId)));

  return row ? toTemplateDto(row) : null;
}

export async function updateQuotationTemplateRecord(
  db: CrmDatabase,
  ownerUserId: string,
  id: string,
  input: UpdateQuotationTemplateInput,
  options?: { now?: Date | undefined },
): Promise<QuotationTemplateDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  const existing = await getQuotationTemplateRecord(db, ownerUserId, id);
  if (!existing) throw new CrmServiceError(404, "not_found", "Quotation template not found.");

  if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
    throw new CrmServiceError(
      409,
      "stale_conflict",
      `Quotation template was modified by another session. Current version is ${existing.version}.`,
    );
  }

  const patch: Record<string, unknown> = {
    updatedAt: nowUtc,
    version: existing.version + 1,
  };

  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new CrmServiceError(400, "validation_error", "Package name cannot be empty.");
    patch["name"] = n;
  }

  if (input.priceType !== undefined) {
    patch["priceType"] = input.priceType;
  }

  const effectiveType = (input.priceType ?? existing.priceType) as "fixed" | "custom";
  if (effectiveType === "fixed") {
    if (input.priceAmount !== undefined) {
      const parse = parseStrictInrInputToPaise(input.priceAmount, { allowZero: false });
      if (!parse.ok) throw new CrmServiceError(400, "validation_error", parse.message);
      patch["priceAmount"] = parse.decimal;
      patch["priceLabel"] = null;
    }
  } else {
    patch["priceAmount"] = null;
    if (input.priceLabel !== undefined) {
      patch["priceLabel"] = input.priceLabel ? input.priceLabel.trim() || "On request" : null;
    }
  }

  if (input.messageBody !== undefined) {
    patch["messageBody"] = input.messageBody.trim();
  }

  if (input.isActive !== undefined) {
    patch["isActive"] = input.isActive;
  }

  if (input.sortOrder !== undefined) {
    patch["sortOrder"] = input.sortOrder;
  }

  const result = await db
    .update(crmQuotationTemplates)
    .set(patch)
    .where(
      and(
        eq(crmQuotationTemplates.id, id),
        eq(crmQuotationTemplates.ownerUserId, ownerUserId),
        eq(crmQuotationTemplates.version, existing.version),
      ),
    );

  if (Number(result[0].affectedRows) === 0) {
    throw new CrmServiceError(409, "stale_conflict", "Concurrent edit conflict updating quotation template.");
  }

  const updated = await getQuotationTemplateRecord(db, ownerUserId, id);
  if (!updated) throw new CrmServiceError(500, "crm_unavailable", "Failed to retrieve updated quotation template.");
  return updated;
}

export async function deleteQuotationTemplateRecord(
  db: CrmDatabase,
  ownerUserId: string,
  id: string,
  options?: { now?: Date | undefined },
): Promise<QuotationTemplateDto> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  const existing = await getQuotationTemplateRecord(db, ownerUserId, id);
  if (!existing) throw new CrmServiceError(404, "not_found", "Quotation template not found.");

  await db
    .update(crmQuotationTemplates)
    .set({
      archivedAt: nowUtc,
      isActive: false,
      updatedAt: nowUtc,
      version: existing.version + 1,
    })
    .where(and(eq(crmQuotationTemplates.id, id), eq(crmQuotationTemplates.ownerUserId, ownerUserId)));

  const updated = await getQuotationTemplateRecord(db, ownerUserId, id);
  if (!updated) throw new CrmServiceError(500, "crm_unavailable", "Failed to retrieve archived quotation template.");
  return updated;
}

export async function reorderQuotationTemplatesRecord(
  db: CrmDatabase,
  ownerUserId: string,
  templateIds: readonly string[],
  options?: { now?: Date | undefined },
): Promise<{ ok: true; reorderedCount: number }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);

  let count = 0;
  await db.transaction(async (tx) => {
    for (let i = 0; i < templateIds.length; i++) {
      const id = templateIds[i];
      if (!id) continue;
      const res = await tx
        .update(crmQuotationTemplates)
        .set({
          sortOrder: i,
          updatedAt: nowUtc,
          version: sql`${crmQuotationTemplates.version} + 1`,
        })
        .where(and(eq(crmQuotationTemplates.id, id), eq(crmQuotationTemplates.ownerUserId, ownerUserId)));
      count += Number(res[0]?.affectedRows ?? 0);
    }
  });

  return { ok: true, reorderedCount: count };
}

export async function duplicateQuotationTemplateRecord(
  db: CrmDatabase,
  ownerUserId: string,
  id: string,
  options?: { now?: Date | undefined },
): Promise<QuotationTemplateDto> {
  const existing = await getQuotationTemplateRecord(db, ownerUserId, id);
  if (!existing) throw new CrmServiceError(404, "not_found", "Quotation template not found.");

  return createQuotationTemplateRecord(
    db,
    ownerUserId,
    {
      name: `${existing.name} (Copy)`,
      priceType: existing.priceType,
      priceAmount: existing.priceAmount ?? undefined,
      priceLabel: existing.priceLabel ?? undefined,
      messageBody: existing.messageBody,
      isActive: existing.isActive,
      sortOrder: existing.sortOrder + 1,
    },
    options,
  );
}

// ---------------------------------------------------------------------------
// Client Quotations Implementation
// ---------------------------------------------------------------------------

export async function createQuotationRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  input: CreateQuotationInput,
  options?: { idempotencyKey?: string | null | undefined; now?: Date | undefined },
): Promise<{ status: number; body: { ok: true; quotation: QuotationDto }; replayed: boolean }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);
  const todayIstDate = toIstParts(now).istDate;

  const title = input.title.trim();
  if (!title) throw new CrmServiceError(400, "validation_error", "Quotation title is required.");

  const clientName = input.clientName.trim();
  if (!clientName) throw new CrmServiceError(400, "validation_error", "Client name is required.");

  // Validate lead if specified
  if (input.leadId) {
    const [lead] = await db
      .select({ id: crmLeads.id })
      .from(crmLeads)
      .where(and(eq(crmLeads.id, input.leadId), eq(crmLeads.ownerUserId, ownerUserId)));
    if (!lead) throw new CrmServiceError(404, "not_found", "Associated lead not found.");
  }

  // Validate deal if specified
  if (input.dealId) {
    const [deal] = await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.id, input.dealId), eq(crmDeals.ownerUserId, ownerUserId)));
    if (!deal) throw new CrmServiceError(404, "not_found", "Associated deal not found.");
  }

  // Validate template if specified
  if (input.templateId) {
    const [tpl] = await db
      .select({ id: crmQuotationTemplates.id })
      .from(crmQuotationTemplates)
      .where(and(eq(crmQuotationTemplates.id, input.templateId), eq(crmQuotationTemplates.ownerUserId, ownerUserId)));
    if (!tpl) throw new CrmServiceError(404, "not_found", "Associated template not found.");
  }

  // Perform financial calculations
  const financials = safeCalculateFinancials({
    items: input.items,
    packagePrice: input.packagePrice,
    discountType: input.discountType,
    discountValue: input.discountValue,
    gstEnabled: input.gstEnabled,
    gstRate: input.gstRate,
    milestones: input.milestones,
  });

  const quoteId = generateServerId("quot");
  const issueIstDate = input.issueIstDate?.trim() || todayIstDate;
  const status: QuotationStatus = input.status ?? (input.userConfirmedSent ? "sent" : "draft");

  // Determine quotation number
  let quotationNumber = input.quotationNumber?.trim();
  if (!quotationNumber) {
    const year = issueIstDate.slice(0, 4);
    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(crmQuotations)
      .where(and(eq(crmQuotations.ownerUserId, ownerUserId), like(crmQuotations.quotationNumber, `QT-${year}-%`)));
    const seq = (countRow?.count ?? 0) + 1;
    quotationNumber = `QT-${year}-${String(seq).padStart(4, "0")}`;
  }

  const executeCreate = async (tx: CrmTransaction): Promise<QuotationDto> => {
    try {
      await tx.insert(crmQuotations).values({
        id: quoteId,
        ownerUserId,
        leadId: input.leadId ?? null,
        dealId: input.dealId ?? null,
        templateId: input.templateId ?? null,
        legacyId: input.legacyId ?? null,
        quotationNumber: quotationNumber!,
        title,
        clientName,
        clientCompany: input.clientCompany?.trim() || null,
        currency: "INR",
        subtotal: financials.subtotalDecimal,
        discountType: financials.discountType,
        discountValue: financials.discountValueDecimal,
        discountAmount: financials.discountAmountDecimal,
        taxableAmount: financials.taxableAmountDecimal,
        gstEnabled: financials.gstEnabled,
        gstRate: financials.gstRateDecimal,
        gstAmount: financials.gstAmountDecimal,
        totalAmount: financials.totalAmountDecimal,
        status,
        issueIstDate,
        validUntilIstDate: input.validUntilIstDate ?? null,
        paymentTerms: input.paymentTerms?.trim() || null,
        notes: input.notes?.trim() || null,
        messageBody: input.messageBody?.trim() || null,
        userConfirmedSent: input.userConfirmedSent ?? (status === "sent"),
        sentAt: status === "sent" ? nowUtc : null,
        acceptedAt: status === "accepted" ? nowUtc : null,
        rejectedAt: status === "rejected" ? nowUtc : null,
        idempotencyKey: options?.idempotencyKey ?? null,
        version: 1,
        archivedAt: null,
        createdAt: nowUtc,
        updatedAt: nowUtc,
      });

      // Insert line items
      if (financials.items.length > 0) {
        const itemRows = financials.items.map((it) => ({
          id: generateServerId("qitem"),
          quotationId: quoteId,
          description: it.description,
          quantity: it.quantityDecimal,
          unitPrice: it.unitPriceDecimal,
          totalAmount: it.totalAmountDecimal,
          sortOrder: it.sortOrder,
          createdAt: nowUtc,
          updatedAt: nowUtc,
        }));
        await tx.insert(crmQuotationItems).values(itemRows);
      }

      // Insert milestones
      if (financials.milestones.length > 0) {
        const milestoneRows = financials.milestones.map((ms) => ({
          id: generateServerId("qms"),
          quotationId: quoteId,
          label: ms.label,
          percentage: ms.percentageDecimal,
          amount: ms.amountDecimal,
          dueDate: ms.dueDate,
          sortOrder: ms.sortOrder,
          createdAt: nowUtc,
          updatedAt: nowUtc,
        }));
        await tx.insert(crmQuotationMilestones).values(milestoneRows);
      }

      // Snapshot revision 1
      const snapshot = {
        title,
        clientName,
        clientCompany: input.clientCompany ?? null,
        subtotal: financials.subtotalDecimal,
        discount: financials.discountAmountDecimal,
        tax: financials.gstAmountDecimal,
        total: financials.totalAmountDecimal,
        items: financials.items,
        milestones: financials.milestones,
        status,
        messageBody: input.messageBody ?? null,
      };

      await tx.insert(crmQuotationRevisions).values({
        id: generateServerId("qrev"),
        quotationId: quoteId,
        revisionNumber: 1,
        snapshotJson: JSON.stringify(snapshot),
        changeSummary: "Initial quotation creation",
        createdByUserId: actorUserId,
        createdAt: nowUtc,
      });

      // Audit event
      await tx.insert(crmQuotationAuditEvents).values({
        id: generateServerId("qev"),
        quotationId: quoteId,
        ownerUserId,
        actorUserId,
        eventType: "quotation.created",
        summary: `Created quotation ${quotationNumber} for ₹${financials.totalAmountDecimal}`,
        detailsJson: JSON.stringify({ quotationNumber, totalAmount: financials.totalAmountDecimal, status }),
        occurredIstDate: todayIstDate,
        createdAt: nowUtc,
      });

      const fullQuote = await fetchFullQuotation(tx, ownerUserId, quoteId);
      if (!fullQuote) throw new CrmServiceError(500, "crm_unavailable", "Failed to retrieve created quotation.");
      return fullQuote;
    } catch (err) {
      if (isMysqlDuplicateKeyError(err)) {
        throw new CrmServiceError(409, "duplicate_quotation", "Quotation number already exists.");
      }
      throw err;
    }
  };

  const scope = "quotation:create";
  const requestHash = hashIdempotentRequest(scope, input);
  return runWithIdempotency<{ ok: true; quotation: QuotationDto }>(
    db,
    {
      ownerUserId,
      scope,
      idemKey: options?.idempotencyKey ?? null,
      requestHash,
      now,
    },
    async (tx: CrmTransaction) => {
      const quote = await executeCreate(tx);
      return { status: 201, body: { ok: true, quotation: quote }, resourceId: quote.id };
    },
  );
}

export async function listQuotationsRecords(
  db: CrmDatabase,
  ownerUserId: string,
  filters: ListQuotationsFilters = {},
): Promise<{ items: QuotationDto[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);

  const conditions = [eq(crmQuotations.ownerUserId, ownerUserId)];

  if (filters.leadId) {
    conditions.push(eq(crmQuotations.leadId, filters.leadId));
  }
  if (filters.dealId) {
    conditions.push(eq(crmQuotations.dealId, filters.dealId));
  }
  if (filters.status) {
    conditions.push(eq(crmQuotations.status, filters.status));
  }
  if (!filters.includeArchived) {
    conditions.push(isNull(crmQuotations.archivedAt));
  }
  if (filters.search) {
    const s = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        like(crmQuotations.quotationNumber, s),
        like(crmQuotations.title, s),
        like(crmQuotations.clientName, s),
      )!,
    );
  }

  const [countResult] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(crmQuotations)
    .where(and(...conditions));
  const total = countResult?.total ?? 0;

  const quoteRows = await db
    .select()
    .from(crmQuotations)
    .where(and(...conditions))
    .orderBy(desc(crmQuotations.createdAt))
    .limit(limit)
    .offset(offset);

  const quoteIds = quoteRows.map((q) => q.id);
  const itemsByQuoteId = new Map<string, QuotationItemDto[]>();
  const milestonesByQuoteId = new Map<string, QuotationMilestoneDto[]>();

  if (quoteIds.length > 0) {
    const itemRows = await db
      .select()
      .from(crmQuotationItems)
      .where(inArray(crmQuotationItems.quotationId, quoteIds))
      .orderBy(crmQuotationItems.sortOrder);

    for (const it of itemRows) {
      const list = itemsByQuoteId.get(it.quotationId) ?? [];
      list.push(toItemDto(it));
      itemsByQuoteId.set(it.quotationId, list);
    }

    const milestoneRows = await db
      .select()
      .from(crmQuotationMilestones)
      .where(inArray(crmQuotationMilestones.quotationId, quoteIds))
      .orderBy(crmQuotationMilestones.sortOrder);

    for (const ms of milestoneRows) {
      const list = milestonesByQuoteId.get(ms.quotationId) ?? [];
      list.push(toMilestoneDto(ms));
      milestonesByQuoteId.set(ms.quotationId, list);
    }
  }

  const items = quoteRows.map((q) =>
    toQuotationDto(q, itemsByQuoteId.get(q.id) ?? [], milestonesByQuoteId.get(q.id) ?? []),
  );

  return { items, total, limit, offset };
}

export async function getQuotationRecord(
  db: CrmDatabase,
  ownerUserId: string,
  id: string,
): Promise<QuotationDto | null> {
  return fetchFullQuotation(db, ownerUserId, id);
}

export async function updateQuotationRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  id: string,
  input: UpdateQuotationInput,
  options?: { idempotencyKey?: string | null | undefined; now?: Date | undefined },
): Promise<{ status: number; body: { ok: true; quotation: QuotationDto }; replayed: boolean }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);
  const todayIstDate = toIstParts(now).istDate;

  const scope = "quotation:update";
  const requestHash = hashIdempotentRequest(scope, { id, ...input });

  return runWithIdempotency<{ ok: true; quotation: QuotationDto }>(
    db,
    {
      ownerUserId,
      scope,
      idemKey: options?.idempotencyKey ?? null,
      requestHash,
      now,
    },
    async (tx: CrmTransaction) => {
      const existing = await fetchFullQuotation(tx, ownerUserId, id);
      if (!existing) throw new CrmServiceError(404, "not_found", "Quotation not found.");

      if (existing.status !== "draft") {
        throw new CrmServiceError(
          400,
          "validation_error",
          `Only draft quotations can be modified (current status is '${existing.status}').`,
        );
      }

      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          `Quotation was modified by another session. Current version is ${existing.version}.`,
        );
      }

      // Recalculate financials
      const financials = safeCalculateFinancials({
        items: input.items ?? existing.items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          sortOrder: i.sortOrder,
        })),
        packagePrice: input.packagePrice,
        discountType: input.discountType ?? existing.discountType,
        discountValue: input.discountValue ?? existing.discountValue,
        gstEnabled: input.gstEnabled ?? existing.gstEnabled,
        gstRate: input.gstRate ?? existing.gstRate,
        milestones: input.milestones ?? existing.milestones.map((m) => ({
          label: m.label,
          percentage: m.percentage,
          amount: m.amount,
          dueDate: m.dueDate,
          sortOrder: m.sortOrder,
        })),
      });

      const nextVersion = existing.version + 1;
      const title = input.title?.trim() || existing.title;
      const clientName = input.clientName?.trim() || existing.clientName;
      const clientCompany = input.clientCompany !== undefined ? input.clientCompany?.trim() || null : existing.clientCompany;

      const updateResult = await tx
        .update(crmQuotations)
        .set({
          title,
          clientName,
          clientCompany,
          subtotal: financials.subtotalDecimal,
          discountType: financials.discountType,
          discountValue: financials.discountValueDecimal,
          discountAmount: financials.discountAmountDecimal,
          taxableAmount: financials.taxableAmountDecimal,
          gstEnabled: financials.gstEnabled,
          gstRate: financials.gstRateDecimal,
          gstAmount: financials.gstAmountDecimal,
          totalAmount: financials.totalAmountDecimal,
          validUntilIstDate: input.validUntilIstDate !== undefined ? input.validUntilIstDate : existing.validUntilIstDate,
          paymentTerms: input.paymentTerms !== undefined ? input.paymentTerms?.trim() || null : existing.paymentTerms,
          notes: input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
          messageBody: input.messageBody !== undefined ? input.messageBody?.trim() || null : existing.messageBody,
          version: nextVersion,
          updatedAt: nowUtc,
        })
        .where(
          and(
            eq(crmQuotations.id, id),
            eq(crmQuotations.ownerUserId, ownerUserId),
            eq(crmQuotations.version, existing.version),
          ),
        );

      if (Number(updateResult[0].affectedRows) === 0) {
        throw new CrmServiceError(409, "stale_conflict", "Concurrent edit conflict updating quotation.");
      }

      // Replace items if specified
      if (input.items !== undefined) {
        await tx.delete(crmQuotationItems).where(eq(crmQuotationItems.quotationId, id));
        if (financials.items.length > 0) {
          const itemRows = financials.items.map((it) => ({
            id: generateServerId("qitem"),
            quotationId: id,
            description: it.description,
            quantity: it.quantityDecimal,
            unitPrice: it.unitPriceDecimal,
            totalAmount: it.totalAmountDecimal,
            sortOrder: it.sortOrder,
            createdAt: nowUtc,
            updatedAt: nowUtc,
          }));
          await tx.insert(crmQuotationItems).values(itemRows);
        }
      }

      // Replace milestones if specified
      if (input.milestones !== undefined) {
        await tx.delete(crmQuotationMilestones).where(eq(crmQuotationMilestones.quotationId, id));
        if (financials.milestones.length > 0) {
          const milestoneRows = financials.milestones.map((ms) => ({
            id: generateServerId("qms"),
            quotationId: id,
            label: ms.label,
            percentage: ms.percentageDecimal,
            amount: ms.amountDecimal,
            dueDate: ms.dueDate,
            sortOrder: ms.sortOrder,
            createdAt: nowUtc,
            updatedAt: nowUtc,
          }));
          await tx.insert(crmQuotationMilestones).values(milestoneRows);
        }
      }

      // Save revision snapshot for update
      const [revCount] = await tx
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmQuotationRevisions)
        .where(eq(crmQuotationRevisions.quotationId, id));
      const nextRev = (revCount?.count ?? 0) + 1;
      const revisionSnapshot = {
        title,
        clientName,
        clientCompany,
        subtotal: financials.subtotalDecimal,
        discount: financials.discountAmountDecimal,
        tax: financials.gstAmountDecimal,
        total: financials.totalAmountDecimal,
        items: financials.items,
        milestones: financials.milestones,
        status: existing.status,
        messageBody: input.messageBody !== undefined ? input.messageBody?.trim() || null : existing.messageBody,
      };

      await tx.insert(crmQuotationRevisions).values({
        id: generateServerId("qrev"),
        quotationId: id,
        revisionNumber: nextRev,
        snapshotJson: JSON.stringify(revisionSnapshot),
        changeSummary: input.changeSummary?.trim() || `Draft updated to ₹${financials.totalAmountDecimal} (v${nextVersion})`,
        createdByUserId: actorUserId,
        createdAt: nowUtc,
      });

      // Record audit event
      await tx.insert(crmQuotationAuditEvents).values({
        id: generateServerId("qev"),
        quotationId: id,
        ownerUserId,
        actorUserId,
        eventType: "quotation.updated",
        summary: `Updated quotation to ₹${financials.totalAmountDecimal} (v${nextVersion})`,
        detailsJson: JSON.stringify({ version: nextVersion, totalAmount: financials.totalAmountDecimal }),
        occurredIstDate: todayIstDate,
        createdAt: nowUtc,
      });

      const updated = await fetchFullQuotation(tx, ownerUserId, id);
      if (!updated) throw new CrmServiceError(500, "crm_unavailable", "Failed to retrieve updated quotation.");
      return { status: 200, body: { ok: true, quotation: updated }, resourceId: id };
    },
  );
}

export async function changeQuotationStatusRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  id: string,
  input: { status: QuotationStatus; reason?: string | undefined; expectedVersion?: number | undefined },
  options?: { idempotencyKey?: string | null | undefined; now?: Date | undefined },
): Promise<{ status: number; body: { ok: true; quotation: QuotationDto }; replayed: boolean }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);
  const todayIstDate = toIstParts(now).istDate;

  const scope = "quotation:status";
  const requestHash = hashIdempotentRequest(scope, { id, ...input });

  return runWithIdempotency<{ ok: true; quotation: QuotationDto }>(
    db,
    {
      ownerUserId,
      scope,
      idemKey: options?.idempotencyKey ?? null,
      requestHash,
      now,
    },
    async (tx: CrmTransaction) => {
      const existing = await fetchFullQuotation(tx, ownerUserId, id);
      if (!existing) throw new CrmServiceError(404, "not_found", "Quotation not found.");

      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
        throw new CrmServiceError(
          409,
          "stale_conflict",
          `Quotation was modified by another session. Current version is ${existing.version}.`,
        );
      }

      const fromStatus = existing.status;
      const toStatus = input.status;
      if (fromStatus === toStatus) {
        return { status: 200, body: { ok: true, quotation: existing }, resourceId: id };
      }

      // Validate state transitions
      const ALLOWED_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
        draft: ["sent", "archived"],
        sent: ["accepted", "rejected", "expired", "archived", "draft"],
        accepted: ["archived"],
        rejected: ["archived", "draft"],
        expired: ["archived", "draft"],
        archived: ["draft"],
      };

      if (!ALLOWED_TRANSITIONS[fromStatus]?.includes(toStatus)) {
        throw new CrmServiceError(
          400,
          "validation_error",
          `Cannot transition quotation status from '${fromStatus}' to '${toStatus}'.`,
        );
      }

      const patch: Record<string, unknown> = {
        status: toStatus,
        updatedAt: nowUtc,
        version: existing.version + 1,
      };

      if (toStatus === "sent") {
        patch["sentAt"] = nowUtc;
        patch["userConfirmedSent"] = true;
      } else if (toStatus === "accepted") {
        patch["acceptedAt"] = nowUtc;
      } else if (toStatus === "rejected") {
        patch["rejectedAt"] = nowUtc;
      }

      const updateResult = await tx
        .update(crmQuotations)
        .set(patch)
        .where(
          and(
            eq(crmQuotations.id, id),
            eq(crmQuotations.ownerUserId, ownerUserId),
            eq(crmQuotations.version, existing.version),
          ),
        );

      if (Number(updateResult[0].affectedRows) === 0) {
        throw new CrmServiceError(409, "stale_conflict", "Concurrent edit conflict updating quotation status.");
      }

      // Take immutable revision snapshot upon 'sent'
      if (toStatus === "sent") {
        const [revCount] = await tx
          .select({ count: sql<number>`COUNT(*)` })
          .from(crmQuotationRevisions)
          .where(eq(crmQuotationRevisions.quotationId, id));

        const nextRev = (revCount?.count ?? 0) + 1;
        const snapshot = {
          title: existing.title,
          clientName: existing.clientName,
          clientCompany: existing.clientCompany,
          subtotal: existing.subtotalDecimal,
          discount: existing.discountAmountDecimal,
          tax: existing.gstAmountDecimal,
          total: existing.totalAmountDecimal,
          items: existing.items,
          milestones: existing.milestones,
          status: "sent",
          messageBody: existing.messageBody,
        };

        await tx.insert(crmQuotationRevisions).values({
          id: generateServerId("qrev"),
          quotationId: id,
          revisionNumber: nextRev,
          snapshotJson: JSON.stringify(snapshot),
          changeSummary: input.reason?.trim() || "Issued quotation marked as sent",
          createdByUserId: actorUserId,
          createdAt: nowUtc,
        });
      }

      // Audit event
      await tx.insert(crmQuotationAuditEvents).values({
        id: generateServerId("qev"),
        quotationId: id,
        ownerUserId,
        actorUserId,
        eventType: "quotation.status_changed",
        summary: `Quotation status changed from ${fromStatus} to ${toStatus}${input.reason ? ` (${input.reason})` : ""}`,
        detailsJson: JSON.stringify({ from: fromStatus, to: toStatus, reason: input.reason ?? null }),
        occurredIstDate: todayIstDate,
        createdAt: nowUtc,
      });

      const updated = await fetchFullQuotation(tx, ownerUserId, id);
      if (!updated) throw new CrmServiceError(500, "crm_unavailable", "Failed to retrieve updated quotation.");
      return { status: 200, body: { ok: true, quotation: updated }, resourceId: id };
    },
  );
}

export async function archiveQuotationRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  id: string,
  reason?: string | undefined,
  options?: { idempotencyKey?: string | null | undefined; now?: Date | undefined },
): Promise<{ status: number; body: { ok: true; quotation: QuotationDto }; replayed: boolean }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);
  const todayIstDate = toIstParts(now).istDate;

  const scope = "quotation:archive";
  const requestHash = hashIdempotentRequest(scope, { id, reason });

  return runWithIdempotency<{ ok: true; quotation: QuotationDto }>(
    db,
    {
      ownerUserId,
      scope,
      idemKey: options?.idempotencyKey ?? null,
      requestHash,
      now,
    },
    async (tx: CrmTransaction) => {
      const existing = await fetchFullQuotation(tx, ownerUserId, id);
      if (!existing) throw new CrmServiceError(404, "not_found", "Quotation not found.");

      await tx
        .update(crmQuotations)
        .set({
          archivedAt: nowUtc,
          status: "archived",
          updatedAt: nowUtc,
          version: existing.version + 1,
        })
        .where(and(eq(crmQuotations.id, id), eq(crmQuotations.ownerUserId, ownerUserId)));

      await tx.insert(crmQuotationAuditEvents).values({
        id: generateServerId("qev"),
        quotationId: id,
        ownerUserId,
        actorUserId,
        eventType: "quotation.archived",
        summary: `Quotation archived${reason ? `: ${reason}` : ""}`,
        detailsJson: JSON.stringify({ reason: reason ?? null }),
        occurredIstDate: todayIstDate,
        createdAt: nowUtc,
      });

      const updated = await fetchFullQuotation(tx, ownerUserId, id);
      if (!updated) throw new CrmServiceError(500, "crm_unavailable", "Failed to retrieve archived quotation.");
      return { status: 200, body: { ok: true, quotation: updated }, resourceId: id };
    },
  );
}

export async function restoreQuotationRecord(
  db: CrmDatabase,
  ownerUserId: string,
  actorUserId: string,
  id: string,
  options?: { idempotencyKey?: string | null | undefined; now?: Date | undefined },
): Promise<{ status: number; body: { ok: true; quotation: QuotationDto }; replayed: boolean }> {
  const now = options?.now ?? new Date();
  const nowUtc = toMysqlUtcDateTime(now);
  const todayIstDate = toIstParts(now).istDate;

  const scope = "quotation:restore";
  const requestHash = hashIdempotentRequest(scope, { id });

  return runWithIdempotency<{ ok: true; quotation: QuotationDto }>(
    db,
    {
      ownerUserId,
      scope,
      idemKey: options?.idempotencyKey ?? null,
      requestHash,
      now,
    },
    async (tx: CrmTransaction) => {
      const existing = await fetchFullQuotation(tx, ownerUserId, id);
      if (!existing) throw new CrmServiceError(404, "not_found", "Quotation not found.");

      await tx
        .update(crmQuotations)
        .set({
          archivedAt: null,
          status: "draft",
          updatedAt: nowUtc,
          version: existing.version + 1,
        })
        .where(and(eq(crmQuotations.id, id), eq(crmQuotations.ownerUserId, ownerUserId)));

      await tx.insert(crmQuotationAuditEvents).values({
        id: generateServerId("qev"),
        quotationId: id,
        ownerUserId,
        actorUserId,
        eventType: "quotation.restored",
        summary: "Quotation restored to draft state",
        detailsJson: null,
        occurredIstDate: todayIstDate,
        createdAt: nowUtc,
      });

      const restored = await fetchFullQuotation(tx, ownerUserId, id);
      if (!restored) throw new CrmServiceError(500, "crm_unavailable", "Failed to retrieve restored quotation.");
      return { status: 200, body: { ok: true, quotation: restored }, resourceId: id };
    },
  );
}

export async function listQuotationRevisionsRecord(
  db: CrmDatabase,
  ownerUserId: string,
  quotationId: string,
  query?: { limit?: number; offset?: number },
): Promise<{ items: QuotationRevisionDto[]; total: number; limit: number; offset: number }> {
  const quote = await db
    .select({ id: crmQuotations.id })
    .from(crmQuotations)
    .where(and(eq(crmQuotations.id, quotationId), eq(crmQuotations.ownerUserId, ownerUserId)));
  if (!quote.length) throw new CrmServiceError(404, "not_found", "Quotation not found.");

  const limit = Math.min(Math.max(query?.limit ?? 50, 1), 100);
  const offset = Math.max(query?.offset ?? 0, 0);

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(crmQuotationRevisions)
    .where(eq(crmQuotationRevisions.quotationId, quotationId));
  const total = Number(countRow?.count ?? 0);

  const rows = await db
    .select()
    .from(crmQuotationRevisions)
    .where(eq(crmQuotationRevisions.quotationId, quotationId))
    .orderBy(desc(crmQuotationRevisions.revisionNumber))
    .limit(limit)
    .offset(offset);

  const items = rows.map((r) => ({
    id: r.id,
    quotationId: r.quotationId,
    revisionNumber: r.revisionNumber,
    snapshot: JSON.parse(r.snapshotJson),
    changeSummary: r.changeSummary,
    createdByUserId: r.createdByUserId,
    createdAt: String(r.createdAt),
  }));

  return { items, total, limit, offset };
}

export async function listQuotationAuditEventsRecord(
  db: CrmDatabase,
  ownerUserId: string,
  quotationId: string,
  query?: { limit?: number; offset?: number; eventType?: string },
): Promise<{ items: QuotationAuditEventDto[]; total: number; limit: number; offset: number }> {
  const quote = await db
    .select({ id: crmQuotations.id })
    .from(crmQuotations)
    .where(and(eq(crmQuotations.id, quotationId), eq(crmQuotations.ownerUserId, ownerUserId)));
  if (!quote.length) throw new CrmServiceError(404, "not_found", "Quotation not found.");

  const limit = Math.min(Math.max(query?.limit ?? 100, 1), 200);
  const offset = Math.max(query?.offset ?? 0, 0);

  const conditions = [
    eq(crmQuotationAuditEvents.quotationId, quotationId),
    eq(crmQuotationAuditEvents.ownerUserId, ownerUserId),
  ];
  if (query?.eventType && query.eventType !== "all") {
    conditions.push(eq(crmQuotationAuditEvents.eventType, query.eventType));
  }

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(crmQuotationAuditEvents)
    .where(and(...conditions));
  const total = Number(countRow?.count ?? 0);

  const rows = await db
    .select()
    .from(crmQuotationAuditEvents)
    .where(and(...conditions))
    .orderBy(desc(crmQuotationAuditEvents.createdAt))
    .limit(limit)
    .offset(offset);

  const items = rows.map((r) => ({
    id: r.id,
    quotationId: r.quotationId,
    ownerUserId: r.ownerUserId,
    actorUserId: r.actorUserId,
    eventType: r.eventType,
    summary: r.summary,
    details: r.detailsJson ? JSON.parse(r.detailsJson) : null,
    occurredIstDate: r.occurredIstDate,
    createdAt: String(r.createdAt),
  }));

  return { items, total, limit, offset };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchFullQuotation(
  db: CrmDatabase | CrmTransaction,
  ownerUserId: string,
  id: string,
): Promise<QuotationDto | null> {
  const [row] = await db
    .select()
    .from(crmQuotations)
    .where(and(eq(crmQuotations.id, id), eq(crmQuotations.ownerUserId, ownerUserId)));

  if (!row) return null;

  const [items, milestones] = await Promise.all([
    db
      .select()
      .from(crmQuotationItems)
      .where(eq(crmQuotationItems.quotationId, id))
      .orderBy(crmQuotationItems.sortOrder),
    db
      .select()
      .from(crmQuotationMilestones)
      .where(eq(crmQuotationMilestones.quotationId, id))
      .orderBy(crmQuotationMilestones.sortOrder),
  ]);

  return toQuotationDto(row, items.map(toItemDto), milestones.map(toMilestoneDto));
}

function toTemplateDto(row: typeof crmQuotationTemplates.$inferSelect): QuotationTemplateDto {
  const num = row.priceAmount ? Number(row.priceAmount) : null;
  const paise = num !== null ? Math.round(num * 100) : null;
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    priceType: row.priceType as "fixed" | "custom",
    priceAmount: num,
    priceAmountDecimal: row.priceAmount ?? null,
    priceAmountPaise: paise,
    priceLabel: row.priceLabel ?? null,
    currency: "INR",
    messageBody: row.messageBody,
    isActive: Boolean(row.isActive),
    sortOrder: row.sortOrder,
    version: row.version,
    archivedAt: row.archivedAt ? String(row.archivedAt) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function toItemDto(row: typeof crmQuotationItems.$inferSelect): QuotationItemDto {
  return {
    id: row.id,
    quotationId: row.quotationId,
    description: row.description,
    quantity: Number(row.quantity),
    quantityDecimal: String(row.quantity),
    unitPrice: Number(row.unitPrice),
    unitPriceDecimal: String(row.unitPrice),
    totalAmount: Number(row.totalAmount),
    totalAmountDecimal: String(row.totalAmount),
    sortOrder: row.sortOrder,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function toMilestoneDto(row: typeof crmQuotationMilestones.$inferSelect): QuotationMilestoneDto {
  return {
    id: row.id,
    quotationId: row.quotationId,
    label: row.label,
    percentage: Number(row.percentage),
    percentageDecimal: String(row.percentage),
    amount: Number(row.amount),
    amountDecimal: String(row.amount),
    dueDate: row.dueDate ?? null,
    sortOrder: row.sortOrder,
    createdAt: String(row.createdAt),
  };
}

function toQuotationDto(
  row: typeof crmQuotations.$inferSelect,
  items: QuotationItemDto[],
  milestones: QuotationMilestoneDto[],
): QuotationDto {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    leadId: row.leadId ?? null,
    dealId: row.dealId ?? null,
    templateId: row.templateId ?? null,
    legacyId: row.legacyId ?? null,
    quotationNumber: row.quotationNumber,
    title: row.title,
    clientName: row.clientName,
    clientCompany: row.clientCompany ?? null,
    currency: "INR",
    subtotal: Number(row.subtotal),
    subtotalDecimal: String(row.subtotal),
    discountType: row.discountType as QuotationDiscountType,
    discountValue: Number(row.discountValue),
    discountValueDecimal: String(row.discountValue),
    discountAmount: Number(row.discountAmount),
    discountAmountDecimal: String(row.discountAmount),
    taxableAmount: Number(row.taxableAmount),
    taxableAmountDecimal: String(row.taxableAmount),
    gstEnabled: Boolean(row.gstEnabled),
    gstRate: Number(row.gstRate),
    gstRateDecimal: String(row.gstRate),
    gstAmount: Number(row.gstAmount),
    gstAmountDecimal: String(row.gstAmount),
    totalAmount: Number(row.totalAmount),
    totalAmountDecimal: String(row.totalAmount),
    status: row.status as QuotationStatus,
    issueIstDate: row.issueIstDate,
    validUntilIstDate: row.validUntilIstDate ?? null,
    paymentTerms: row.paymentTerms ?? null,
    notes: row.notes ?? null,
    messageBody: row.messageBody ?? null,
    userConfirmedSent: Boolean(row.userConfirmedSent),
    sentAt: row.sentAt ? String(row.sentAt) : null,
    acceptedAt: row.acceptedAt ? String(row.acceptedAt) : null,
    rejectedAt: row.rejectedAt ? String(row.rejectedAt) : null,
    version: row.version,
    archivedAt: row.archivedAt ? String(row.archivedAt) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    items,
    milestones,
  };
}
