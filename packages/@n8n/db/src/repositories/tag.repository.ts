import { Service } from '@n8n/di';
import type { EntityManager } from '@n8n/typeorm';
import { DataSource, In, Repository } from '@n8n/typeorm';
import intersection from 'lodash/intersection';

import { TagEntity } from '../entities';
import type { IWorkflowDb } from '../entities/types-db';

@Service()
export class TagRepository extends Repository<TagEntity> {
	constructor(dataSource: DataSource) {
		super(TagEntity, dataSource.manager);
	}

	async findMany(tagIds: string[], projectId: string) {
		return await this.find({
			select: ['id', 'name', 'projectId'],
			where: { id: In(tagIds), projectId },
		});
	}

	/**
	 * Set tags on workflow to import while ensuring all tags exist in the database,
	 * either by matching incoming to existing tags or by creating them first.
	 * This method assumes `dbTags` are already filtered for the relevant project.
	 */
	async setTags(
		tx: EntityManager,
		dbTags: TagEntity[],
		workflow: IWorkflowDb,
		projectId: string,
	) {
		if (!workflow?.tags?.length) return;

		for (let i = 0; i < workflow.tags.length; i++) {
			const importTag = workflow.tags[i];

			if (!importTag.name) continue;

			// It's crucial that dbTags are pre-filtered for the projectId.
			const identicalMatch = dbTags.find(
				(dbTag) =>
					dbTag.id === importTag.id &&
					dbTag.projectId === projectId && // Ensure project match
					dbTag.createdAt &&
					importTag.createdAt &&
					dbTag.createdAt.getTime() === new Date(importTag.createdAt).getTime(),
			);

			if (identicalMatch) {
				workflow.tags[i] = identicalMatch;
				continue;
			}

			// Match by name within the same project.
			const nameMatch = dbTags.find(
				(dbTag) => dbTag.name === importTag.name && dbTag.projectId === projectId,
			);

			if (nameMatch) {
				workflow.tags[i] = nameMatch;
				continue;
			}

			// If no match, create a new tag within the project.
			const tagEntity = this.create({ ...importTag, projectId });

			workflow.tags[i] = await tx.save<TagEntity>(tagEntity);
		}
	}

	/**
	 * Returns the workflow IDs that have certain tags.
	 * Intersection! e.g. workflow needs to have all provided tags.
	 */
	async getWorkflowIdsViaTags(tags: string[], projectId: string): Promise<string[]> {
		const dbTags = await this.find({
			where: { name: In(tags), projectId }, // Filter by projectId
			relations: ['workflows'],
		});

		// Filter workflows by project before extracting IDs
		const workflowIdsPerTag = dbTags.map((tag) =>
			tag.workflows
				.filter((workflow) => workflow.projectId === projectId) // Ensure workflow is in the same project
				.map((workflow) => workflow.id),
		);

		return intersection(...workflowIdsPerTag);
	}
}
