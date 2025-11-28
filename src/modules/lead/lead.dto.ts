import type { Lead } from "@prisma/client";

export type BulkCreateLeadsResponse = { count: number };
export type UpdateLeadStatusResponse = Lead;

export type GetLeadByIdResponse = Lead | null;
export type GetLeadsByTaskResponse = Lead[];