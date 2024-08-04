import userMiddleware, { type UserMiddlewareType } from "@/Middleware/User.ts";
import type API from "@/Utils/Classes/API.ts";
import GuildMemberFlags from "@/Utils/Classes/BitFields/GuildMember.ts";
import Permissions from "@/Utils/Classes/BitFields/Permissions.ts";
import Encryption from "@/Utils/Classes/Encryption.ts";
import errorGen from "@/Utils/Classes/ErrorGen.ts";
import ContentTypes from "@/Utils/Classes/Routing/Decorators/ContentTypes.ts";
import Description from "@/Utils/Classes/Routing/Decorators/Description.ts";
import Method from "@/Utils/Classes/Routing/Decorators/Method.ts";
import Middleware from "@/Utils/Classes/Routing/Decorators/Middleware.ts";
import Route, { type CreateRoute } from "@/Utils/Classes/Routing/Route.ts";
import { guildMembersTable, type GuildMemberTable } from "@/Utils/Cql/Tables/GuildMemberTable.ts";
import { rolesTable } from "@/Utils/Cql/Tables/RoleTable.ts";
import type { bigintPair } from "@/Utils/Cql/Types/PermissionsOverides.ts";
import PermissionHandler from "@/Utils/Versioning/v1/PermissionCheck.ts";

export default class AddRemoveRole extends Route {
	public constructor(App: API) {
		super(App);
	}

	@Method("put")
	@Description("Add a role to a member")
	@ContentTypes("any")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: "User",
		}),
	)
	public async putRole({
		user,
		params,
		set,
	}: CreateRoute<"/:guildId/members/:memberId/roles/:roleId", any, [UserMiddlewareType]>) {
		const member = await this.permissionChecker({ set, params, user } as CreateRoute<
			"/:guildId/members/:memberId/roles/:roleId",
			any,
			[UserMiddlewareType]
		>);

		if (set.status !== 200 || "code" in member) {
			return member;
		}

		
		if (member.roles.includes(Encryption.encrypt(params.roleId))) {
			// ? they already got the role no need to error out
			// ? we also don't send a guildMember.update event.. though possibly should? if someone complains we can talk about it
			set.status = 204;

			return;
		}

		member.roles.push(Encryption.encrypt(params.roleId));

		await guildMembersTable.update(
			{
				guildId: Encryption.encrypt(params.guildId),
				guildMemberId: member.guildMemberId!,
				left: false,
			},
			{ roles: member.roles },
		);

		set.status = 204;

		// this.App.rabbitMQForwarder("guildMember.update", {});

		return;
	}

	@Method("delete")
	@Description("Remove a role from a member")
	@ContentTypes("any")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: "User",
		}),
	)
	public async deleteRole({
		user,
		params,
		set,
	}: CreateRoute<"/:guildId/members/:memberId/roles/:roleId", any, [UserMiddlewareType]>) {
		const member = await this.permissionChecker({ set, params, user } as CreateRoute<
			"/:guildId/members/:memberId/roles/:roleId",
			any,
			[UserMiddlewareType]
		>);

		if (set.status !== 200 || "code" in member) {
			return member;
		}
		
		if (params.roleId === params.guildId) {
			set.status = 400;

			const badRequest = errorGen.InvalidRole();

			badRequest.addError({
				roleId: {
					code: "InvalidRole",
					message: "You cannot remove the default role from a member.",
				},
			});

			return badRequest.toJSON();
		}

		if (!member.roles.includes(Encryption.encrypt(params.roleId))) {
			// ? they don't have the role no need to error out
			// ? we also don't send a guildMember.update event.. though possibly should? if someone complains we can talk about it
			set.status = 204;

			return;
		}

		member.roles = member.roles.filter((role) => role !== Encryption.encrypt(params.roleId));

		await guildMembersTable.update(
			{
				guildId: Encryption.encrypt(params.guildId),
				guildMemberId: member.guildMemberId!,
				left: false,
			},
			{ roles: member.roles },
		);

		set.status = 204;

		// this.App.rabbitMQForwarder("guildMember.update", {});

		return;
	}

	private async permissionChecker({
		set,
		params,
		user,
	}: CreateRoute<"/:guildId/members/:memberId/roles/:roleId", any, [UserMiddlewareType]>): Promise<
		| {
				code: number;
				errors: Record<string, any>;
		  }
		| GuildMemberTable
	> {
		const invalidGuild = errorGen.UnknownGuild();

		invalidGuild.addError({
			guildId: {
				code: "UnknownGuild",
				message: "The provided guild does not exist, or you do not have access to it.",
			},
		});

		if (!user.guilds.includes(params.guildId)) {
			set.status = 404;

			this.App.logger.debug("Not in array");

			return invalidGuild.toJSON();
		}

		const guildMember = await guildMembersTable.get(
			{
				guildId: Encryption.encrypt(params.guildId),
				userId: Encryption.encrypt(user.id),
				left: false,
			},
			{ fields: ["flags", "roles"] },
		);

		if (!guildMember) {
			set.status = 404;

			this.App.logger.debug("Guild member not found");

			return invalidGuild.toJSON();
		}

		const guildMemberFlags = new GuildMemberFlags(guildMember.flags ?? 0);

		if (!guildMemberFlags.has("In")) {
			set.status = 404;

			this.App.logger.debug("Not in guild", guildMember);

			return invalidGuild.toJSON();
		}

		const usersRoles = (
			await Promise.all(
				guildMember.roles.map(async (id) =>
					rolesTable.get(
						{ roleId: id, guildId: Encryption.encrypt(params.guildId) },
						{ fields: ["roleId", "permissions", "position"] },
					),
				),
			)
		).filter((rol) => rol !== null);

		const permissionCheck = new PermissionHandler(
			user.id,
			guildMember.flags ?? 0,
			usersRoles.map((role) => ({
				id: role.roleId!,
				permissions: Permissions.permissionFromDatabase(role.permissions as bigintPair[]),
				position: role.position ?? 0,
			})),
			[],
		);

		if (!permissionCheck.hasAnyRole(["ManageMemberRoles"])) {
			set.status = 403;

			const missingPermission = errorGen.MissingPermissions();

			missingPermission.addError({
				channel: {
					code: "MissingPermissions",
					message: 'You are missing the "ManageMemberRoles" permission.',
					requiredPermissions: ["ManageMemberRoles"], // ? note: this is a testing field, may be removed later
				},
			});

			return missingPermission.toJSON();
		}

		const member = await guildMembersTable.get(
			{
				guildId: Encryption.encrypt(params.guildId),
				userId: Encryption.encrypt(params.memberId === "@me" ? user.id : params.memberId),
				left: false,
			},
			{ fields: ["roles", "guildMemberId"] },
		);

		if (!member) {
			set.status = 404;

			const notFound = errorGen.UnknownMember();

			notFound.addError({
				memberId: {
					code: "UnknownMember",
					message: "The provided member does not exist in this guild.",
				},
			});

			return notFound.toJSON();
		}

		const foundRole = await rolesTable.get(
			{
				roleId: Encryption.encrypt(params.roleId),
				guildId: Encryption.encrypt(params.guildId),
			},
			{ fields: ["permissions", "position"] },
		);

		if (!foundRole) {
			set.status = 404;

			const notFound = errorGen.UnknownRole();

			notFound.addError({
				roleId: {
					code: "UnknownRole",
					message: "The provided role does not exist in this guild.",
				},
			});

			return notFound.toJSON();
		}

		if (
			!permissionCheck.canManageRole({
				id: Encryption.decrypt(params.roleId),
				permissions: Permissions.permissionFromDatabase(foundRole.permissions as bigintPair[]),
				position: foundRole.position ?? 0,
			})
		) {
			set.status = 403;

			const missingPermission = errorGen.MissingPermissions();

			// ? This error message is kind of misleading, due to the fact you DO have permissions its just you cannot manage that role
			// ? Oh well, someone else can fix it later :3
			missingPermission.addError({
				channel: {
					code: "MissingPermissions",
					message: 'You are missing the "ManageRole" permission.',
					requiredPermissions: ["ManageRole"], // ? note: this is a testing field, may be removed later
				},
			});

			return missingPermission.toJSON();
		}

		return member as GuildMemberTable;
	}
}
