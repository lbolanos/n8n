import { Service } from '@n8n/di';
import { DataSource, In, Repository } from '@n8n/typeorm';

import { FolderTagMapping } from '../entities/folder-tag-mapping';
import { TagEntity } from '../entities/tag-entity'; // Import TagEntity for validation

@Service()
export class FolderTagMappingRepository extends Repository<FolderTagMapping> {
	constructor(dataSource: DataSource) {
		super(FolderTagMapping, dataSource.manager);
	}

	async overwriteTags(folderId: string, tagIds: string[], projectId: string) {
		return await this.manager.transaction(async (tx) => {
			// Validate that all provided tagIds exist and belong to the specified projectId
			if (tagIds.length > 0) {
				const validTags = await tx.find(TagEntity, {
					where: {
						id: In(tagIds),
						projectId: projectId,
					},
					select: ['id'],
				});

				if (validTags.length !== tagIds.length) {
					const foundTagIds = validTags.map((t) => t.id);
					const missingTagIds = tagIds.filter((id) => !foundTagIds.includes(id));
					throw new Error(
						`Invalid tag IDs for project ${projectId}: ${missingTagIds.join(', ')}. Tags must exist and belong to the project.`,
					);
				}
			}

			// Proceed with deleting old mappings and inserting new ones
			await tx.delete(FolderTagMapping, { folderId });

			if (tagIds.length === 0) {
				return; // No new tags to insert
			}

			const newMappings = tagIds.map((tagId) =>
				this.create({ folderId, tagId }),
			);

			return await tx.insert(FolderTagMapping, newMappings);
		});
	}
}
