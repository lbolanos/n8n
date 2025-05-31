import { CreateOrUpdateTagRequestDto, RetrieveTagQueryDto } from '@n8n/api-types';
import {
	Delete,
	Get,
	Patch,
	Post,
	RestController,
	GlobalScope,
	Body,
	Param,
	Query,
} from '@n8n/decorators';
import { Response } from 'express';

import { AuthenticatedRequest } from '@/requests';
import { TagService } from '@/services/tag.service';

// Assuming routes are now project-scoped e.g., /projects/:projectId/tags
// and ProjectContextMiddleware has populated req.projectId
@RestController('/tags') // Base path might be adjusted by router for project scoping
export class TagsController {
	constructor(private readonly tagService: TagService) {}

	// Example: GET /projects/:projectId/tags
	@Get('/')
	@GlobalScope('tag:list') // Scope now implicitly applies within the project context
	async getAll(req: AuthenticatedRequest, _res: Response, @Query query: RetrieveTagQueryDto) {
		const projectId = (req as any).projectId as string;
		if (!projectId) {
			throw new Error('projectId is missing from request.'); // Or handle via error middleware
		}
		return await this.tagService.getAll(projectId, { withUsageCount: query.withUsageCount });
	}

	// Example: POST /projects/:projectId/tags
	@Post('/')
	@GlobalScope('tag:create') // Scope now implicitly applies within the project context
	async createTag(
		req: AuthenticatedRequest,
		_res: Response,
		@Body payload: CreateOrUpdateTagRequestDto,
	) {
		const projectId = (req as any).projectId as string;
		if (!projectId) {
			throw new Error('projectId is missing from request.');
		}
		const { name } = payload;
		// TagService.toEntity now requires projectId
		const tag = this.tagService.toEntity({ name, projectId });

		return await this.tagService.save(tag, 'create');
	}

	// Example: PATCH /projects/:projectId/tags/:id
	@Patch('/:id')
	@GlobalScope('tag:update') // Scope now implicitly applies within the project context
	async updateTag(
		req: AuthenticatedRequest,
		_res: Response,
		@Param('id') tagId: string,
		@Body payload: CreateOrUpdateTagRequestDto,
	) {
		const projectId = (req as any).projectId as string;
		if (!projectId) {
			throw new Error('projectId is missing from request.');
		}
		// Ensure tag belongs to project by fetching it first (TagService.getById now does this)
		await this.tagService.getById(tagId, projectId); // Throws if not found in project

		// TagService.toEntity now requires projectId
		const newTag = this.tagService.toEntity({ id: tagId, name: payload.name, projectId });

		return await this.tagService.save(newTag, 'update');
	}

	// Example: DELETE /projects/:projectId/tags/:id
	@Delete('/:id')
	@GlobalScope('tag:delete') // Scope now implicitly applies within the project context
	async deleteTag(req: AuthenticatedRequest, _res: Response, @Param('id') tagId: string) {
		const projectId = (req as any).projectId as string;
		if (!projectId) {
			throw new Error('projectId is missing from request.');
		}
		// TagService.delete now requires projectId for validation
		await this.tagService.delete(tagId, projectId);
		return true;
	}
}
