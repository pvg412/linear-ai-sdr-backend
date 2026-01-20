import type { Container } from "inversify";

import { loadEnv } from "@/config/env";
import { OBJECT_STORAGE_TYPES } from "./object-storage.types";
import {
	LeadSearchRawStorage,
	MinioLeadSearchRawStorage,
	NoopLeadSearchRawStorage,
} from "./lead-search-raw.storage";

const env = loadEnv();

function isMinioEnabled(): boolean {
	return Boolean(
		env.MINIO_ENDPOINT?.trim() &&
			env.MINIO_ACCESS_KEY?.trim() &&
			env.MINIO_SECRET_KEY?.trim()
	);
}

export function registerObjectStorageModule(container: Container) {
	container
		.bind<LeadSearchRawStorage>(OBJECT_STORAGE_TYPES.LeadSearchRawStorage)
		.toDynamicValue(() => {
			if (!isMinioEnabled()) return new NoopLeadSearchRawStorage();
			return new MinioLeadSearchRawStorage();
		})
		.inSingletonScope();
}

