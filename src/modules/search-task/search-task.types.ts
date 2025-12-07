export const SEARCH_TASK_TYPES = {
  SearchTaskRepository: Symbol.for('SearchTaskRepository'),
  SearchTaskCommandService: Symbol.for('SearchTaskCommandService'),
  SearchTaskQueryService: Symbol.for('SearchTaskQueryService'),
} as const;