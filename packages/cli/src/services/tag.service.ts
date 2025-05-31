import type { TagEntity, ITagWithCountDb } from '@n8n/db';
import { TagRepository } from '@n8n/db';
import { Service } from '@n8n/di';

import { ExternalHooks } from '@/external-hooks';
import { validateEntity } from '@/generic-helpers';

type GetAllResult<T> = T extends { withUsageCount: true } ? ITagWithCountDb[] : TagEntity[];

type Action = 'Create' | 'Update';

@Service()
export class TagService {
	constructor(
		private externalHooks: ExternalHooks,
		private tagRepository: TagRepository,
	) {}

	toEntity(attrs: { name: string; projectId: string; id?: string }) {
		attrs.name = attrs.name.trim();

		return this.tagRepository.create(attrs);
	}

	async save(tag: TagEntity, actionKind: 'create' | 'update') {
		await validateEntity(tag);

		const action = (actionKind[0].toUpperCase() + actionKind.slice(1)) as Action;

		await this.externalHooks.run(`tag.before${action}`, [tag]);

		const savedTag = this.tagRepository.save(tag, { transaction: false });

		await this.externalHooks.run(`tag.after${action}`, [tag]);

		return await savedTag;
	}

	async delete(id: string, projectId: string) {
		// First, verify the tag belongs to the specified project
		const tag = await this.tagRepository.findOneBy({ id, projectId });
		if (!tag) {
			// Or throw a more specific "NotFoundInProjectError"
			throw new Error(`Tag with id "${id}" not found in project "${projectId}"`);
		}

		await this.externalHooks.run('tag.beforeDelete', [id]);

		const deleteResult = this.tagRepository.delete(id);

		await this.externalHooks.run('tag.afterDelete', [id]);

		return await deleteResult;
	}

	async getAll<T extends { withUsageCount: boolean }>(
		projectId: string,
		options?: T,
	): Promise<GetAllResult<T>> {
		if (options?.withUsageCount) {
			const tags = await this.tagRepository
				.createQueryBuilder('tag')
				.select(['tag.id', 'tag.name', 'tag.createdAt', 'tag.updatedAt', 'tag.projectId'])
				.where('tag.projectId = :projectId', { projectId })
				.loadRelationCountAndMap('tag.usageCount', 'tag.workflowMappings', 'wm', (qb) =>
					qb.leftJoin('wm.workflows', 'workflow').where('workflow.isArchived = :isArchived', {
						isArchived: false,
					}),
				)
				.getMany();

			return tags as GetAllResult<T>;
		}

		return await (this.tagRepository.find({
			select: ['id', 'name', 'createdAt', 'updatedAt', 'projectId'],
			where: { projectId },
		}) as Promise<GetAllResult<T>>);
	}

	async getById(id: string, projectId: string) {
		return await this.tagRepository.findOneOrFail({
			where: { id, projectId },
		});
	}

	/**
	 * Sort tags based on the order of the tag IDs in the request.
	 */
	sortByRequestOrder(tags: TagEntity[], { requestOrder }: { requestOrder: string[] }) {
		const tagMap = tags.reduce<Record<string, TagEntity>>((acc, tag) => {
			acc[tag.id] = tag;
			return acc;
		}, {});

		return requestOrder.map((tagId) => tagMap[tagId]);
	}
}
