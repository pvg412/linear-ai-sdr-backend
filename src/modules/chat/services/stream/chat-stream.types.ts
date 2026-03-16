// Shared types for chat stream service

import type { Prisma } from "@prisma/client";
import type { ChatMode } from "@/generated/aisdr/v1/ai_sdr";

export type Json = Prisma.InputJsonValue;
export type UnknownRecord = Record<string, unknown>;

export interface Citation {
  documentId: string;
  leadId?: string;
  directoryId?: string;
  score?: number;
  snippet?: string;
}

export interface OutreachVariantJson {
  channel: string;
  stage: string;
  subject: string;
  body: string;
  variants: string[];
  characterCount: number;
  wordCount: number;
  containsLink: boolean;
  usageNote?: string;
  tacticUsed?: string;
  warnings?: string[];
}

export interface OutreachMessageJson {
  type: "outreach";
  outreachVariants: OutreachVariantJson[];
}

export interface OutreachContextInput {
  channel?: string;
  stage?: string;
  dayInSequence?: number;
  followUpNumber?: number;
  suggestedTactic?: string;
  leadResponseType?: string;
  customInstructions?: string;
  leadId?: string;
  directoryId?: string;
  userPrompt?: string;
  directoryIds?: string[];
}

export interface StreamAssistantInput {
  userId: string;
  /** Company-level workspace ID for RAG/ChromaDB scoping.
   *  Pass companyId for SALE_MANAGER users (parent company),
   *  or null/undefined for COMPANY users (userId is used as fallback). */
  companyId?: string | null;
  threadId: string;
  text: string;
  clientMessageId?: string;
  defaultDirectoryIds?: string[];
  mode?: ChatMode;
  outreachContext?: OutreachContextInput;
  signal?: AbortSignal;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function readString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

export function readNumber(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
