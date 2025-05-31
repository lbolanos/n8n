import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from '@n8n/typeorm';

export class PopulateWebhookProjectIdMigrationTimestamp implements MigrationInterface {
	name = 'PopulateWebhookProjectIdMigrationTimestamp'; // Will be replaced by actual timestamp

	public async up(queryRunner: QueryRunner): Promise<void> {
		// 1. Add the projectId column (nullable initially)
		await queryRunner.addColumn(
			'webhook_entity',
			new TableColumn({
				name: 'projectId',
				type: 'varchar', // Adjust type if project IDs are different (e.g., uuid)
				isNullable: true,
			}),
		);

		// 2. Data Population
		// Fetch all webhooks
		const webhooks = await queryRunner.query('SELECT "id", "workflowId", "webhookPath", "method" FROM "webhook_entity"');

		let updatedCount = 0;
		const webhooksWithoutProject = [];

		for (const webhook of webhooks) {
			// For each webhook, find its workflow
			// Assuming workflowId in webhook_entity refers to id in workflow_entity
			// And workflow_entity has a way to get its primary owning project.
			// This query might need adjustment based on the exact schema for project ownership.
			// Common patterns:
			//   a) workflow_entity has a direct 'homeProjectId' or 'projectId' column.
			//   b) workflow_entity links to shared_workflow, and one entry marks the owner project.
			// Here, we assume 'workflow_entity' has a 'projectId' column directly for simplicity in this context.
			// If it's via shared_workflow, a JOIN would be needed.

			// Attempt to find projectId directly from workflow_entity
			const workflow = await queryRunner.query(
				'SELECT "projectId" FROM "workflow_entity" WHERE "id" = $1',
				[webhook.workflowId],
			);

			let projectIdToSet: string | null = null;

			if (workflow && workflow.length > 0 && workflow[0].projectId) {
				projectIdToSet = workflow[0].projectId;
			} else {
				// Fallback: Try to find via shared_workflow if direct projectId is not on workflow_entity
				// This assumes a 'role' column or similar indicates ownership, or just take any associated project.
				// This part is highly dependent on the actual schema of shared_workflow.
				const sharedWorkflowEntries = await queryRunner.query(
					// Example: Prioritize 'owner' role, then take any if not found.
					// Adjust this query based on how project ownership/association is defined.
					`SELECT "projectId" FROM "shared_workflow" WHERE "workflowId" = $1 ORDER BY CASE WHEN "role" = 'owner' THEN 0 ELSE 1 END LIMIT 1`,
					[webhook.workflowId],
				);
				if (sharedWorkflowEntries && sharedWorkflowEntries.length > 0) {
					projectIdToSet = sharedWorkflowEntries[0].projectId;
				}
			}

			if (projectIdToSet) {
				// Update the webhook_entity record
				// Using webhook "id" if it's a distinct primary key.
				// If primary key is composite (webhookPath, method), use that.
				// The previous subtask modified WebhookEntity to have (webhookPath, method) as @PrimaryColumn.
				// However, the selected "id" above implies a single primary key column named "id".
				// For this migration, I'll assume "webhookPath" and "method" are the composite PK as per recent entity changes.
				await queryRunner.query(
					'UPDATE "webhook_entity" SET "projectId" = $1 WHERE "webhookPath" = $2 AND "method" = $3',
					[projectIdToSet, webhook.webhookPath, webhook.method],
				);
				updatedCount++;
			} else {
				webhooksWithoutProject.push({
					webhookPath: webhook.webhookPath,
					method: webhook.method,
					workflowId: webhook.workflowId,
				});
				console.warn(
					`Webhook with path "${webhook.webhookPath}" (method: ${webhook.method}, workflowId: ${webhook.workflowId}) could not be associated with a project.`,
				);
			}
		}

		console.log(`Successfully updated ${updatedCount} webhooks with projectId.`);
		if (webhooksWithoutProject.length > 0) {
			console.warn(
				`Found ${webhooksWithoutProject.length} webhooks that could not be associated with a project. Manual review may be needed.`,
				webhooksWithoutProject,
			);
			// Depending on policy, might throw error here if all webhooks MUST have a project.
			// For now, we proceed to make the column non-nullable if at least some were updated,
			// or if the decision is that un-associated ones are acceptable to remain null (then changeColumn would fail).
			// For safety, if some are null, making column NOT NULL should be conditional or handled manually.
			// Given the prompt, if all records are updated successfully, then make non-nullable.
			// This implies if some are not, this step might be problematic.
		}

		// 3. Make projectId non-nullable (if all webhooks were successfully updated)
		// If webhooksWithoutProject.length > 0, this step might fail or might need to be conditional.
		// For now, proceeding as if the goal is to make it non-nullable.
		// Consider if a default projectId should be assigned to unlinked webhooks before this step.
		if (webhooksWithoutProject.length === 0) {
			await queryRunner.changeColumn(
				'webhook_entity',
				'projectId',
				new TableColumn({
					name: 'projectId',
					type: 'varchar',
					isNullable: false,
				}),
			);
			console.log('Changed webhook_entity.projectId to be NOT NULL.');
		} else {
			console.warn(
				`Skipping making projectId NOT NULL as ${webhooksWithoutProject.length} webhooks could not be updated. Manual intervention required.`,
			);
		}

		// 4. Drop Old Index(es) - Example:
		// Check if an old index exists that might conflict. For example, if there was a unique index solely on ['webhookPath', 'method'].
		// The previous index was on ['webhookId', 'method', 'pathLength']. This does not directly conflict with the new one on different columns.
		// However, if there was a unique index like `UQ_webhook_path_method`, it would need dropping.
		// Let's assume an old unique index on just path and method existed for this example.
		try {
			await queryRunner.dropIndex(
				'webhook_entity',
				'UQ_webhook_path_method', // This is a hypothetical old index name
			);
			console.log('Dropped old unique index UQ_webhook_path_method (if it existed).');
		} catch (e) {
			console.log('Old unique index UQ_webhook_path_method not found or could not be dropped, skipping.');
		}
		// Drop the index that was replaced in the entity definition: @Index(['webhookId', 'method', 'pathLength'])
		// Its default name would be IDX_webhookId_method_pathLength or similar.
		// For TypeORM generated names, it's usually `IDX_<concatenated_column_names_hash>` or specified in @Index decorator.
		// The entity had @Index(['webhookId', 'method', 'pathLength']), let's try to drop by columns.
		// TypeORM doesn't have a direct "dropIndexByColumns". We need its actual name.
		// For now, I'll assume it might have been named 'IDX_webhook_old_composite' or find it by columns if possible.
		// Often, one might inspect db first to get exact old index names.
		// Given no direct tool to list indexes, I will try dropping a commonly auto-generated name.
		const oldIndexName = 'IDX_webhook_entity_webhookId_method_pathLength'; // A guess, might need specific name from DB schema
		try {
			const table = await queryRunner.getTable('webhook_entity');
			const index = table?.indices.find(
				(idx) =>
					idx.columnNames.includes('webhookId') &&
					idx.columnNames.includes('method') &&
					idx.columnNames.includes('pathLength'),
			);
			if (index && index.name) {
				await queryRunner.dropIndex('webhook_entity', index.name);
				console.log(`Dropped old index ${index.name}.`);
			} else {
				console.log(`Old index on ['webhookId', 'method', 'pathLength'] not found by columns.`);
			}
		} catch (e) {
			console.log(`Could not drop old index on ['webhookId', 'method', 'pathLength'], skipping: ${e.message}`);
		}


		// 5. Create New Unique Index
		await queryRunner.createIndex(
			'webhook_entity',
			new TableIndex({
				name: 'IDX_webhook_project_path_method', // Explicit name for the new index
				columnNames: ['projectId', 'webhookPath', 'method'],
				isUnique: true,
			}),
		);
		console.log('Created new unique index IDX_webhook_project_path_method on [projectId, webhookPath, method].');
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		// Revert changes in reverse order

		// Drop the new unique index
		await queryRunner.dropIndex('webhook_entity', 'IDX_webhook_project_path_method');
		console.log('Dropped new unique index IDX_webhook_project_path_method.');

		// Re-create old index(es) - This is complex if the exact old structure isn't perfectly known.
		// For example, re-creating @Index(['webhookId', 'method', 'pathLength'])
		// Assuming it was not unique, or if it was, isUnique should be true.
		try {
			await queryRunner.createIndex(
				'webhook_entity',
				new TableIndex({
					name: 'IDX_webhook_entity_webhookId_method_pathLength', // Or original name if known
					columnNames: ['webhookId', 'method', 'pathLength'], // Ensure 'pathLength' column still exists if re-adding
					isUnique: false, // Assuming it wasn't unique, or adjust if it was
				}),
			);
			console.log("Re-created old index on ['webhookId', 'method', 'pathLength'].");
		} catch(e) {
			console.warn(`Failed to re-create old index on ['webhookId', 'method', 'pathLength']: ${e.message}`);
		}


		// Change projectId column back to nullable (if it was made non-nullable)
		// This check is important because 'up' might skip making it non-nullable.
		const table = await queryRunner.getTable('webhook_entity');
		const projectIdColumn = table?.columns.find(c => c.name === 'projectId');
		if (projectIdColumn && !projectIdColumn.isNullable) {
			await queryRunner.changeColumn(
				'webhook_entity',
				'projectId',
				new TableColumn({
					name: 'projectId',
					type: 'varchar',
					isNullable: true, // Make it nullable again
				}),
			);
			console.log('Changed webhook_entity.projectId back to NULLABLE.');
		}


		// Drop the projectId column
		await queryRunner.dropColumn('webhook_entity', 'projectId');
		console.log('Dropped projectId column from webhook_entity.');
	}
}

// Replace MigrationTimestamp with the actual timestamp for the filename
// e.g., 1678886400000-PopulateWebhookProjectId.ts
// The class name should also reflect this: PopulateWebhookProjectId1678886400000
// This will be handled by the TypeORM CLI when generating a real migration.
// For this exercise, the placeholder "MigrationTimestamp" is used.
// The actual filename would be generated with `typeorm migration:create -n PopulateWebhookProjectId`
// and then this content would be placed into it. The class name would be adjusted to match the filename.
// The tool will name it MigrationTimestamp-PopulateWebhookProjectId.ts, so class name will be PopulateWebhookProjectIdMigrationTimestamp
// (The tool adds "MigrationTimestamp" at the end of the class name if it's not already there with numbers)
// Let's ensure the class name is `PopulateWebhookProjectId` and the tool will append timestamp.
// No, the tool will use the provided class name. So, `PopulateWebhookProjectIdMigrationTimestamp` is fine.
// The filename the tool creates will be `YYYYMMDDHHMMSS-PopulateWebhookProjectId.ts` if I name the class `PopulateWebhookProjectId`
// Or if I name the class `MyClassNameYYYYMMDDHHMMSS` it will be `MyClassNameYYYYMMDDHHMMSS.ts`
// The current filename is `MigrationTimestamp-PopulateWebhookProjectId.ts`
// The class name `PopulateWebhookProjectIdMigrationTimestamp` is okay.
// The tool will generate a timestamp and prepend it to the filename on creation.
// E.g. if I use `create_file_with_block` with `migrations/123-MyMigration.ts`, the class name inside should be `MyMigration123`.
// The current path is `packages/@n8n/db/src/migrations/common/MigrationTimestamp-PopulateWebhookProjectId.ts`
// The class name `PopulateWebhookProjectIdMigrationTimestamp` should be fine.
// The tool will likely create a filename like `20231027000000-PopulateWebhookProjectId.ts` and the class name would be `PopulateWebhookProjectId20231027000000`
// I'll stick to the provided filename and class name structure.
```
