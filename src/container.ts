import "reflect-metadata";
import { Container } from "inversify";

import { registerLeadDirectoryModule } from "./modules/lead-directory/lead-directory.module";
import { registerLeadSearchModule } from "./modules/lead-search/lead-directory.module";
import { registerChatModule } from "./modules/chat/chat.module";
import { registerLeadModule } from "./modules/lead/lead.module";
import { registerScraperModule } from "./capabilities/scraper/scraper.module";
import { registerLeadDbModule } from "./capabilities/lead-db/lead-db.module";
import { registerQueueModule } from "./infra/queue/queue.module";
import { registerRealtimeModule } from "./infra/realtime/realtime.module";
import { registerAiGrpcClientModule } from "./infra/ai-grpc-client/ai-grpc-client.module";
import { registerLeadRagModule } from "./modules/lead-rag/lead-rag.module";
import { registerObjectStorageModule } from "./infra/object-storage/object-storage.module";
import { registerCompanyResearchModule } from "./modules/company-research/company-research.module";
import { registerProfileEnrichmentModule } from "./modules/profile-enrichment/profile-enrichment.module";
import { registerLeadConversationsModule } from "./modules/lead-conversations/lead-conversations.module";
import { registerDatasetImportModule } from "./modules/dataset-import/dataset-import.module";
import { registerServiceCatalogModule } from "./modules/service-catalog/service-catalog.module";
import { registerAdminModule } from "./modules/admin/admin.module";
import { registerHiringSignalsModule } from "./capabilities/hiring-signals/hiring-signals.module";
import { registerPipelineModule } from "./modules/pipeline/pipeline.module";

const container = new Container();

registerAiGrpcClientModule(container);
registerRealtimeModule(container);
registerQueueModule(container);
registerObjectStorageModule(container);
registerLeadRagModule(container);
registerScraperModule(container);
registerLeadDbModule(container);
registerLeadModule(container);
registerChatModule(container);
registerLeadSearchModule(container);
registerLeadDirectoryModule(container);
registerCompanyResearchModule(container);
registerProfileEnrichmentModule(container);
registerLeadConversationsModule(container);
registerDatasetImportModule(container);
registerServiceCatalogModule(container);
registerAdminModule(container); // before hiring-signals — providers depend on ServiceToggleService
registerHiringSignalsModule(container);
registerPipelineModule(container);

export { container };
