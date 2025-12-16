import { injectable } from "inversify";
import { SearchTaskStatus, type Prisma } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

@injectable()
export class SearchTaskRepository {
	async createTask(data: Prisma.SearchTaskCreateInput) {
		const prisma = getPrisma();

		return prisma.searchTask.create({ data });
	}

	async update(id: string, data: Prisma.SearchTaskUpdateInput) {
		const prisma = getPrisma();

		return prisma.searchTask.update({
			where: { id },
			data,
		});
	}

	async findById(id: string) {
		const prisma = getPrisma();

		return prisma.searchTask.findUnique({ where: { id } });
	}

	async findActive(limit = 50) {
		const prisma = getPrisma();

		return prisma.searchTask.findMany({
			where: {
				status: { in: [SearchTaskStatus.PENDING, SearchTaskStatus.RUNNING] },
			},
			orderBy: { createdAt: "asc" },
			take: limit,
		});
	}
}
