import type { Container } from "inversify";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { tryCreateRedisClient } from "./redis.client";
import { QUEUE_TYPES } from "./queue.types";
import { createLeadSearchQueue } from "./lead-search.queue";
import { LeadSearchJobData, LeadSearchJobName } from "./lead-search.queue";

const redis = tryCreateRedisClient();

export function registerQueueModule(container: Container) {
	if (redis) {
		container.bind<Redis>(QUEUE_TYPES.Redis).toConstantValue(redis);

		const leadSearchQueue = createLeadSearchQueue(redis);

		container
			.bind<Queue<LeadSearchJobData, void, LeadSearchJobName>>(
				QUEUE_TYPES.LeadSearchQueue
			)
			.toConstantValue(leadSearchQueue);
	} else {
		console.warn("[queue] REDIS_URL not set; LeadSearch will run inline");
	}
}
