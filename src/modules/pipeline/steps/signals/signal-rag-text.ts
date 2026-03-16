import { createHash } from "crypto";

import type { CrunchbaseSignalResult } from "@/capabilities/crunchbase-signals/crunchbase-signal-provider.dto";
import type { SignalJobDto } from "@/capabilities/hiring-signals/signal-provider.dto";
import type { RedditSignalPostDto } from "@/capabilities/reddit-signals/reddit-signal-provider.dto";
import { RAG_CONSTANTS } from "@/config/constants";

import type { HiringLeadDetail } from "./hiring-signal.processor";
import type { RedditLeadDetail } from "./reddit-signal.processor";

/* ------------------------------------------------------------------ */
/*  Document ID helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Generates a stable 12-char hex key from one or more string parts.
 * Used to create content-derived document IDs so the same item in
 * a subsequent pipeline run gets the same documentId → content_hash
 * comparison → skip (no re-embedding).
 */
export function signalItemKey(parts: Array<string | null | undefined>): string {
  const input = parts.filter(Boolean).join("|");
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

/**
 * Builds a stable documentId for a signal document.
 *
 * @param type    Signal type: "hiring" | "reddit" | "crunchbase"
 * @param leadId  Lead identifier
 * @param itemKey Per-item key from signalItemKey(). Omit for the summary doc.
 *
 * Examples:
 *   signalDocId("reddit",    leadId)           → "signal:reddit:{leadId}:summary"
 *   signalDocId("reddit",    leadId, "a1b2c3") → "signal:reddit:{leadId}:a1b2c3"
 *   signalDocId("hiring",    leadId, "f7e8d9") → "signal:hiring:{leadId}:f7e8d9"
 *   signalDocId("crunchbase",leadId)           → "signal:crunchbase:{leadId}"
 */
export function signalDocId(
  type: "hiring" | "reddit" | "crunchbase",
  leadId: string,
  itemKey?: string,
): string {
  if (!itemKey) {
    return type === "crunchbase"
      ? `signal:crunchbase:${leadId}`
      : `signal:${type}:${leadId}:summary`;
  }
  return `signal:${type}:${leadId}:${itemKey}`;
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                           */
/* ------------------------------------------------------------------ */

function clamp(s: string): string {
  if (s.length <= RAG_CONSTANTS.MAX_DOC_CHARS) return s;
  return s.slice(0, RAG_CONSTANTS.MAX_DOC_CHARS - 1) + "…";
}

/* ------------------------------------------------------------------ */
/*  Hiring — per-job document                                          */
/* ------------------------------------------------------------------ */

/**
 * One document per job listing. Each document is independently embedded,
 * enabling precise semantic retrieval ("company hiring Go engineers").
 */
export function hiringJobToRagText(
  companyName: string,
  job: SignalJobDto,
): string {
  const lines: string[] = [];

  const titlePart = job.jobTitle ? `${companyName}: ${job.jobTitle}` : companyName;
  lines.push(`Job at ${titlePart}`);

  const meta = [job.team, job.jobType, job.locationType].filter(Boolean);
  if (meta.length > 0) lines.push(meta.join(" | "));

  if (job.datePosted) lines.push(`Posted: ${job.datePosted}`);

  const locs = job.locations
    .map((l) => [l.city, l.region, l.country].filter(Boolean).join(", "))
    .filter(Boolean);
  if (locs.length > 0) lines.push(`Locations: ${locs.join(" / ")}`);
  else if (job.locationType) lines.push(`Location: ${job.locationType}`);

  if (job.skills.length > 0) lines.push(`Skills: ${job.skills.join(", ")}`);
  if (job.technologies.length > 0) lines.push(`Tech: ${job.technologies.join(", ")}`);
  if (job.jobCategories.length > 0) lines.push(`Categories: ${job.jobCategories.join(", ")}`);
  if (job.requirementsSummary) lines.push(`Requirements: ${job.requirementsSummary}`);

  return clamp(lines.join("\n"));
}

/**
 * Summary document — aggregate stats without individual job listings.
 * Gives the AI a high-level overview of hiring activity for the company.
 */
export function hiringSignalSummaryText(
  companyName: string,
  detail: HiringLeadDetail,
): string {
  const lines: string[] = [];

  lines.push(`Hiring Signal Summary for ${companyName}`);
  lines.push(`Open Positions: ${detail.openJobCount}`);

  const depts = Array.from(detail.departments);
  if (depts.length > 0) lines.push(`Departments: ${depts.join(", ")}`);

  const titles = Array.from(detail.topJobTitles).slice(0, 10);
  if (titles.length > 0) lines.push(`Top Job Titles: ${titles.join(", ")}`);

  return clamp(lines.join("\n"));
}

/* ------------------------------------------------------------------ */
/*  Reddit — per-post document                                         */
/* ------------------------------------------------------------------ */

/**
 * One document per Reddit post/comment. Each document is independently
 * embedded, enabling precise semantic retrieval ("Stripe mentioned on
 * r/devops in context of reliability issues").
 */
export function redditPostToRagText(
  companyName: string,
  post: RedditSignalPostDto,
): string {
  const lines: string[] = [];

  lines.push(`Reddit Post about ${companyName} in r/${post.subreddit}`);
  lines.push(`Type: ${post.postType}/${post.signalType}`);

  if (post.title) lines.push(`Title: ${post.title}`);

  if (post.content) {
    const snippet =
      post.content.length > 500
        ? post.content.slice(0, 499) + "…"
        : post.content;
    lines.push(`Content: ${snippet}`);
  }

  const meta: string[] = [];
  if (post.score != null) meta.push(`Score: ${post.score}`);
  if (post.numComments != null) meta.push(`Comments: ${post.numComments}`);
  if (post.createdUtc) meta.push(`Date: ${post.createdUtc}`);
  if (meta.length > 0) lines.push(meta.join(" | "));

  if (post.url) lines.push(`URL: ${post.url}`);

  return clamp(lines.join("\n"));
}

/**
 * Summary document — aggregate stats without individual post content.
 * Gives the AI a high-level overview of Reddit presence for the company.
 */
export function redditSignalSummaryText(
  companyName: string,
  detail: RedditLeadDetail,
): string {
  const lines: string[] = [];

  lines.push(`Reddit Signal Summary for ${companyName}`);
  lines.push(`Total Mentions: ${detail.totalMentions}`);

  const subreddits = Array.from(detail.subredditsFound);
  if (subreddits.length > 0) lines.push(`Subreddits: ${subreddits.join(", ")}`);

  return clamp(lines.join("\n"));
}

/* ------------------------------------------------------------------ */
/*  Crunchbase — single flat document (unchanged)                      */
/* ------------------------------------------------------------------ */

/**
 * Single document per lead — Crunchbase data is flat company metadata,
 * not a list of items, so per-item splitting doesn't apply.
 */
export function crunchbaseSignalToRagText(
  companyName: string,
  result: CrunchbaseSignalResult,
): string {
  const lines: string[] = [];

  lines.push(`Crunchbase Signal for ${companyName}`);

  if (!result.crunchbaseFound) {
    lines.push("Company not found on Crunchbase.");
    return clamp(lines.join("\n"));
  }

  if (result.shortDescription) lines.push(`Description: ${result.shortDescription}`);
  if (result.operatingStatus) lines.push(`Status: ${result.operatingStatus}`);
  if (result.foundedOn) lines.push(`Founded: ${result.foundedOn}`);
  if (result.employeeCountEnum) lines.push(`Employees: ${result.employeeCountEnum}`);
  if (result.semrushVisits != null)
    lines.push(`Web Traffic: ${result.semrushVisits.toLocaleString()} visits/mo`);

  const fundingParts: string[] = [];
  if (result.fundingTotalUsd != null)
    fundingParts.push(`$${result.fundingTotalUsd.toLocaleString()} total`);
  if (result.numFundingRounds != null)
    fundingParts.push(`${result.numFundingRounds} rounds`);
  if (result.lastFundingType) fundingParts.push(`last: ${result.lastFundingType}`);
  if (result.lastFundingAt) fundingParts.push(`on ${result.lastFundingAt}`);
  if (result.numInvestors != null)
    fundingParts.push(`${result.numInvestors} investors`);
  if (fundingParts.length > 0) lines.push(`Funding: ${fundingParts.join(", ")}`);

  const scoreParts: string[] = [];
  if (result.growthScore != null) scoreParts.push(`Growth: ${result.growthScore}`);
  if (result.heatScore != null) scoreParts.push(`Heat: ${result.heatScore}`);
  if (scoreParts.length > 0) lines.push(`Scores: ${scoreParts.join(" | ")}`);

  const predParts: string[] = [];
  if (result.fundingPrediction != null)
    predParts.push(`Funding: ${result.fundingPrediction}`);
  if (result.ipoPrediction != null) predParts.push(`IPO: ${result.ipoPrediction}`);
  if (result.acquisitionPrediction != null)
    predParts.push(`Acquisition: ${result.acquisitionPrediction}`);
  if (predParts.length > 0) lines.push(`Predictions: ${predParts.join(" | ")}`);

  if (result.categories) lines.push(`Categories: ${result.categories}`);
  if (result.techStack) lines.push(`Tech Stack: ${result.techStack}`);
  if (result.topCompetitors) lines.push(`Competitors: ${result.topCompetitors}`);
  if (result.hadLayoffs) lines.push("Layoffs: Yes");
  if (result.crunchbasePermalink) lines.push(`Crunchbase: ${result.crunchbasePermalink}`);

  return clamp(lines.join("\n"));
}
