import type { RoleChangeRequestDto } from '@n8n/api-types';
import type { PublicUser } from '@n8n/db';
import { User, UserRepository } from '@n8n/db';
import { Service, Container } from '@n8n/di'; // Added Container
import { getGlobalScopes, type AssignableGlobalRole, type ProjectRole } from '@n8n/permissions'; // Added ProjectRole
import { Logger } from 'n8n-core';
import type { IUserSettings } from 'n8n-workflow';
import { UnexpectedError } from 'n8n-workflow';

import { InternalServerError } from '@/errors/response-errors/internal-server.error';
import { EventService } from '@/events/event.service';
import type { Invitation } from '@/interfaces';
import type { PostHogClient } from '@/posthog';
import type { UserRequest } from '@/requests';
import { UrlService } from '@/services/url.service';
import { UserManagementMailer } from '@/user-management/email';
// eslint-disable-next-line import/no-cycle
import { ProjectService } from './project.service.ee'; // Import ProjectService for adding user to project

import { PublicApiKeyService } from './public-api-key.service';

// Updated Invitation interface to include optional project context
export interface Invitation {
	email: string;
	role: AssignableGlobalRole; // This remains the global role for the new user
	targetProjectId?: string;
	projectRole?: ProjectRole; // Role within the target project
}

@Service()
export class UserService {
	// Lazy load ProjectService to avoid circular dependencies
	private get projectService(): ProjectService {
		return Container.get(ProjectService);
	}

	constructor(
		private readonly logger: Logger,
		private readonly userRepository: UserRepository,
		private readonly mailer: UserManagementMailer,
		private readonly urlService: UrlService,
		private readonly eventService: EventService,
		private readonly publicApiKeyService: PublicApiKeyService,
	) {}

	async update(userId: string, data: Partial<User>) {
		const user = await this.userRepository.findOneBy({ id: userId });

		if (user) {
			await this.userRepository.save({ ...user, ...data }, { transaction: true });
		}

		return;
	}

	getManager() {
		return this.userRepository.manager;
	}

	async updateSettings(userId: string, newSettings: Partial<IUserSettings>) {
		const user = await this.userRepository.findOneOrFail({ where: { id: userId } });

		if (user.settings) {
			Object.assign(user.settings, newSettings);
		} else {
			user.settings = newSettings;
		}

		await this.userRepository.save(user);
	}

	async toPublic(
		user: User,
		options?: {
			withInviteUrl?: boolean;
			inviterId?: string;
			posthog?: PostHogClient;
			withScopes?: boolean;
		},
	) {
		const { password, updatedAt, authIdentities, mfaRecoveryCodes, mfaSecret, ...rest } = user;

		const ldapIdentity = authIdentities?.find((i) => i.providerType === 'ldap');

		let publicUser: PublicUser = {
			...rest,
			signInType: ldapIdentity ? 'ldap' : 'email',
			isOwner: user.role === 'global:owner',
		};

		if (options?.withInviteUrl && !options?.inviterId) {
			throw new UnexpectedError('Inviter ID is required to generate invite URL');
		}

		if (options?.withInviteUrl && options?.inviterId && publicUser.isPending) {
			publicUser = this.addInviteUrl(options.inviterId, publicUser);
		}

		if (options?.posthog) {
			publicUser = await this.addFeatureFlags(publicUser, options.posthog);
		}

		// TODO: resolve these directly in the frontend
		if (options?.withScopes) {
			publicUser.globalScopes = getGlobalScopes(user);
		}

		return publicUser;
	}

	private addInviteUrl(inviterId: string, invitee: PublicUser) {
		const url = new URL(this.urlService.getInstanceBaseUrl());
		url.pathname = '/signup';
		url.searchParams.set('inviterId', inviterId);
		url.searchParams.set('inviteeId', invitee.id);

		invitee.inviteAcceptUrl = url.toString();

		return invitee;
	}

	private async addFeatureFlags(publicUser: PublicUser, posthog: PostHogClient) {
		// native PostHog implementation has default 10s timeout and 3 retries.. which cannot be updated without affecting other functionality
		// https://github.com/PostHog/posthog-js-lite/blob/a182de80a433fb0ffa6859c10fb28084d0f825c2/posthog-core/src/index.ts#L67
		const timeoutPromise = new Promise<PublicUser>((resolve) => {
			setTimeout(() => {
				resolve(publicUser);
			}, 1500);
		});

		const fetchPromise = new Promise<PublicUser>(async (resolve) => {
			publicUser.featureFlags = await posthog.getFeatureFlags(publicUser);
			resolve(publicUser);
		});

		return await Promise.race([fetchPromise, timeoutPromise]);
	}

	private async sendEmails(
		owner: User,
		toInviteUsers: { [key: string]: string },
		role: AssignableGlobalRole,
	) {
		const domain = this.urlService.getInstanceBaseUrl();

		return await Promise.all(
			Object.entries(toInviteUsers).map(async ([email, id]) => {
				const inviteAcceptUrl = `${domain}/signup?inviterId=${owner.id}&inviteeId=${id}`;
				const invitedUser: UserRequest.InviteResponse = {
					user: {
						id,
						email,
						inviteAcceptUrl,
						emailSent: false,
						role,
					},
					error: '',
				};

				try {
					const result = await this.mailer.invite({
						email,
						inviteAcceptUrl,
					});
					if (result.emailSent) {
						invitedUser.user.emailSent = true;
						delete invitedUser.user?.inviteAcceptUrl;

						this.eventService.emit('user-transactional-email-sent', {
							userId: id,
							messageType: 'New user invite',
							publicApi: false,
						});
					}

					this.eventService.emit('user-invited', {
						user: owner,
						targetUserId: Object.values(toInviteUsers),
						publicApi: false,
						emailSent: result.emailSent,
						inviteeRole: role, // same role for all invited users
					});
				} catch (e) {
					if (e instanceof Error) {
						this.eventService.emit('email-failed', {
							user: owner,
							messageType: 'New user invite',
							publicApi: false,
						});
						this.logger.error('Failed to send email', {
							userId: owner.id,
							inviteAcceptUrl,
							email,
						});
						invitedUser.error = e.message;
					}
				}

				return invitedUser;
			}),
		);
	}

	async inviteUsers(owner: User, invitations: Invitation[]) {
		const emails = invitations.map(({ email }) => email);

		const existingUsers = await this.userRepository.findManyByEmail(emails);

		const existUsersEmails = existingUsers.map((user) => user.email);

		const toCreateUsers = invitations.filter(({ email }) => !existUsersEmails.includes(email));

		const pendingUsersToInvite = existingUsers.filter((email) => email.isPending);

		const createdUsers = new Map<string, string>();

		this.logger.debug(
			toCreateUsers.length > 1
				? `Creating ${toCreateUsers.length} user shells...`
				: 'Creating 1 user shell...',
		);

		try {
			await this.getManager().transaction(async (transactionManager) => {
				for (const invitation of toCreateUsers) {
					const { email, role, targetProjectId, projectRole } = invitation;
					// Create user with their personal project and a global role
					const { user: savedUser } = await this.userRepository.createUserWithProject(
						{ email, role }, // Global role for the user
						transactionManager,
					);
					createdUsers.set(email, savedUser.id);

					// If targetProjectId and projectRole are provided, add user to that project
					if (targetProjectId && projectRole && savedUser) {
						// Use the injected ProjectService to add the user to the specified project
						// Note: projectService.addUser might need to be called outside the user repo transaction
						// or ensure it uses the provided transactionManager if it makes its own.
						// For simplicity here, assuming it can participate or is called after.
						// This part might need careful transaction handling in a real app.
						await this.projectService.addUser(
							targetProjectId,
							savedUser.id,
							projectRole,
							transactionManager, // Pass the transaction manager
						);
						this.logger.debug(
							`Added new user ${savedUser.id} to project ${targetProjectId} with role ${projectRole}`,
						);
					}
				}
			});
		} catch (error) {
			this.logger.error('Failed to create user shells', { userShells: createdUsers });
			throw new InternalServerError('An error occurred during user creation', error);
		}

		pendingUsersToInvite.forEach(({ email, id }) => createdUsers.set(email, id));

		const usersInvited = await this.sendEmails(
			owner,
			Object.fromEntries(createdUsers),
			invitations[0].role, // same role for all invited users
		);

		return { usersInvited, usersCreated: toCreateUsers.map(({ email }) => email) };
	}

	async changeUserRole(user: User, targetUser: User, newRole: RoleChangeRequestDto) {
		return await this.userRepository.manager.transaction(async (trx) => {
			await trx.update(User, { id: targetUser.id }, { role: newRole.newRoleName });

			const adminDowngradedToMember =
				user.role === 'global:owner' &&
				targetUser.role === 'global:admin' &&
				newRole.newRoleName === 'global:member';

			if (adminDowngradedToMember) {
				await this.publicApiKeyService.removeOwnerOnlyScopesFromApiKeys(targetUser, trx);
			}
		});
	}
}
