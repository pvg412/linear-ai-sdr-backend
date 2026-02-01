// Citation parsing utilities

import {
  isRecord,
  readNumber,
  readString,
  type Citation,
} from "./chat-stream.types";

export function parseCitations(itemsUnknown: unknown): Citation[] {
  if (!Array.isArray(itemsUnknown)) return [];

  const out: Citation[] = [];
  for (const it of itemsUnknown) {
    if (!isRecord(it)) continue;

    const documentId =
      readString(it, "documentId") ?? readString(it, "document_id");
    if (!documentId) continue;

    const leadId = readString(it, "leadId") ?? readString(it, "lead_id");
    const directoryId =
      readString(it, "directoryId") ?? readString(it, "directory_id");
    const score = readNumber(it, "score");
    const snippet = readString(it, "snippet");

    out.push({ documentId, leadId, directoryId, score, snippet });
  }

  return out;
}
