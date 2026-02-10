import type { Container } from "inversify";

import { DATASET_IMPORT_TYPES } from "./dataset-import.types";
import { DatasetImportParserService } from "./services/dataset-import.parser.service";
import { DatasetImportCommandService } from "./services/dataset-import.command.service";
import { DatasetImportQueryService } from "./services/dataset-import.query.service";

export function registerDatasetImportModule(container: Container) {
  container
    .bind(DATASET_IMPORT_TYPES.DatasetImportParserService)
    .to(DatasetImportParserService)
    .inSingletonScope();

  container
    .bind(DATASET_IMPORT_TYPES.DatasetImportCommandService)
    .to(DatasetImportCommandService)
    .inSingletonScope();

  container
    .bind(DATASET_IMPORT_TYPES.DatasetImportQueryService)
    .to(DatasetImportQueryService)
    .inSingletonScope();
}
