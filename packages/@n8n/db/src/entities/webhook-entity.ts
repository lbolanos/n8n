import { Column, Entity, Index, PrimaryColumn, ManyToOne, JoinColumn } from '@n8n/typeorm';
import { IHttpRequestMethods } from 'n8n-workflow';
import { Project } from './project'; // Assuming Project entity is in the same directory or correctly pathed

@Entity()
// Old Index: @Index(['webhookId', 'method', 'pathLength'])
@Index(['projectId', 'webhookPath', 'method'], { unique: true }) // New unique index per project
export class WebhookEntity {
	@Column()
	workflowId: string;

	@PrimaryColumn() // webhookPath is part of the composite primary key with method
	webhookPath: string;

	@PrimaryColumn({ type: 'text' }) // method is part of the composite primary key
	method: IHttpRequestMethods;

	@Column()
	node: string;

	@Column({ nullable: true })
	webhookId?: string; // This seems like a unique ID for the webhook registration itself, could be kept.

	// @Column({ nullable: true }) // pathLength might be redundant if not used in new indexing.
	// pathLength?: number;

	// ---- New fields for Project Scoping ----
	@Column()
	projectId: string;

	@ManyToOne(() => Project) // Or simply 'Project' if that's how TypeORM is configured
	@JoinColumn({ name: 'projectId' })
	project: Project;
	// ---- End of New fields ----


	/**
	 * Unique section of webhook path.
	 *
	 * - Static: `${uuid}` or `user/defined/path`
	 * - Dynamic: `${uuid}/user/:id/posts`
	 *
	 * Appended to `${instanceUrl}/webhook/` or `${instanceUrl}/test-webhook/`.
	 */
	private get uniquePath() {
		// This might need to consider projectId if paths are truly project-scoped in the URL
		return this.webhookPath.includes(':')
			? [this.webhookId, this.webhookPath].join('/') // webhookId is likely still useful for dynamic parts
			: this.webhookPath;
	}

	get cacheKey() {
		// Cache key MUST now include projectId
		return `webhook:${this.projectId}:${this.method}-${this.uniquePath}`;
	}

	get staticSegments() {
		return this.webhookPath.split('/').filter((s) => !s.startsWith(':'));
	}

	/**
	 * Whether the webhook has at least one dynamic path segment, e.g. `:id` in `<uuid>/user/:id/posts`.
	 */
	get isDynamic() {
		return this.webhookPath.split('/').some((s) => s.startsWith(':'));
	}

	display() {
		return `${this.method} ${this.webhookPath}`;
	}
}
