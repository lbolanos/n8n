import { Container } from '@n8n/di';
import type express from 'express';
import { Logger } from 'n8n-core';
import { ensureError, type IHttpRequestMethods } from 'n8n-workflow';

import { WebhookNotFoundError } from '@/errors/response-errors/webhook-not-found.error';
import * as ResponseHelper from '@/response-helper';
import type {
	IWebhookManager,
	WebhookOptionsRequest,
	WebhookRequest,
} from '@/webhooks/webhook.types';

import { WebhookService } from './webhook.service';

const WEBHOOK_METHODS: IHttpRequestMethods[] = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'];

class WebhookRequestHandler {
	constructor(private readonly webhookManager: IWebhookManager) {}

	/**
	 * Handles an incoming webhook request. Handles CORS and delegates the
	 * request to the webhook manager to execute the webhook.
	 */
	async handleRequest(req: WebhookRequest | WebhookOptionsRequest, res: express.Response) {
		const method = req.method;

		if (method !== 'OPTIONS' && !WEBHOOK_METHODS.includes(method)) {
			return ResponseHelper.sendErrorResponse(
				res,
				new Error(`The method ${method} is not supported.`),
			);
		}

		// Setup CORS headers only if the incoming request has an `origin` header
		if ('origin' in req.headers) {
			const corsSetupError = await this.setupCorsHeaders(req, res);
			if (corsSetupError) {
				return ResponseHelper.sendErrorResponse(res, corsSetupError);
			}
		}

		if (method === 'OPTIONS') {
			return ResponseHelper.sendSuccessResponse(res, {}, true, 204);
		}

		try {
			const response = await this.webhookManager.executeWebhook(req, res);

			// Don't respond, if already responded
			if (response.noWebhookResponse !== true) {
				ResponseHelper.sendSuccessResponse(
					res,
					response.data,
					true,
					response.responseCode,
					response.headers,
				);
			}
		} catch (e) {
			const error = ensureError(e);

			const logger = Container.get(Logger);

			if (e instanceof WebhookNotFoundError) {
				const currentlyRegistered = await Container.get(WebhookService).findAll();
				logger.error(`Received request for unknown webhook: ${e.message}`, {
					currentlyRegistered: currentlyRegistered.map((w) => w.display()),
				});
			} else {
				logger.error(
					`Error in handling webhook request ${req.method} ${req.path}: ${error.message}`,
					{ stacktrace: error.stack },
				);
			}

			return ResponseHelper.sendErrorResponse(res, error);
		}
	}

	private async setupCorsHeaders(
		req: WebhookRequest | WebhookOptionsRequest,
		res: express.Response,
	): Promise<Error | null> {
		const method = req.method;
		const { path } = req.params;
		// Assume projectId is available on the request object
		const projectId = (req as any).projectId as string | undefined;

		// Note: If projectId is essential for CORS and not found,
		// an error should probably be thrown or default restrictive CORS applied.
		// For now, proceeding with optional projectId for these calls,
		// assuming manager methods can handle it or it's not strictly required for CORS.

		if (this.webhookManager.getWebhookMethods) {
			try {
				// Pass projectId if available, otherwise undefined
				const allowedMethods = await this.webhookManager.getWebhookMethods(path, projectId);
				res.header('Access-Control-Allow-Methods', ['OPTIONS', ...allowedMethods].join(', '));
			} catch (error) {
				return error as Error;
			}
		}

		const requestedMethod =
			method === 'OPTIONS'
				? (req.headers['access-control-request-method'] as IHttpRequestMethods)
				: method;
		if (this.webhookManager.findAccessControlOptions && requestedMethod) {
			// Pass projectId if available
			const options = await this.webhookManager.findAccessControlOptions(
				path,
				requestedMethod,
				projectId,
			);
			const { allowedOrigins } = options ?? {};

			if (allowedOrigins && allowedOrigins !== '*' && allowedOrigins !== req.headers.origin) {
				const originsList = allowedOrigins.split(',');
				const defaultOrigin = originsList[0];

				if (originsList.length === 1) {
					res.header('Access-Control-Allow-Origin', defaultOrigin);
				}

				if (originsList.includes(req.headers.origin as string)) {
					res.header('Access-Control-Allow-Origin', req.headers.origin);
				} else {
					res.header('Access-Control-Allow-Origin', defaultOrigin);
				}
			} else {
				res.header('Access-Control-Allow-Origin', req.headers.origin);
			}

			if (method === 'OPTIONS') {
				res.header('Access-Control-Max-Age', '300');
				const requestedHeaders = req.headers['access-control-request-headers'];
				if (requestedHeaders?.length) {
					res.header('Access-Control-Allow-Headers', requestedHeaders);
				}
			}
		}

		return null;
	}
}

export function createWebhookHandlerFor(webhookManager: IWebhookManager) {
	const handler = new WebhookRequestHandler(webhookManager);

	return async (req: WebhookRequest | WebhookOptionsRequest, res: express.Response) => {
		const { params } = req;
		if (Array.isArray(params.path)) {
			params.path = params.path.join('/');
		}
		await handler.handleRequest(req, res);
	};
}
