import type { SearchTask } from '@prisma/client';

export type CreateSearchTaskResponse = SearchTask;
export type MarkRunningResponse = SearchTask;
export type MarkDoneResponse = SearchTask;
export type MarkFailedResponse = SearchTask;

export type GetSearchTaskResponse = SearchTask | null;
export type ListSearchTasksResponse = SearchTask[];