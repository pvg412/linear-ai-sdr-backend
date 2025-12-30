import "reflect-metadata";
import { Container } from "inversify";

import { registerLeadDirectoryModule } from "./modules/lead-directory/lead-directory.module";
import { registerLeadSearchModule } from "./modules/lead-search/lead-directory.module";
import { registerChatModule } from "./modules/chat/chat.module";
import { registerLeadModule } from "./modules/lead/lead.module";
import { registerAiModule } from "./modules/ai/ai.module";
import { registerScraperModule } from "./capabilities/scraper/scraper.module";
import { registerLeadDbModule } from "./capabilities/lead-db/lead-db.module";
import { registerQueueModule } from "./infra/queue/queue.module";
import { registerRealtimeModule } from "./infra/realtime/realtime.module";

const container = new Container();

registerRealtimeModule(container);
registerQueueModule(container);
registerScraperModule(container);
registerLeadDbModule(container);
registerAiModule(container);
registerLeadModule(container);
registerChatModule(container);
registerLeadSearchModule(container);
registerLeadDirectoryModule(container);

export { container };
