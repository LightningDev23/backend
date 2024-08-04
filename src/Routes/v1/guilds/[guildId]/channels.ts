import Constants from "@/Constants.ts";
import bodyValidator from "@/Middleware/BodyValidator.ts";
import userMiddleware, { type UserMiddlewareType } from "@/Middleware/User.ts";
import { any, boolean, enums, type Infer, number, object, snowflake, string } from "@/Types/BodyValidation.ts";
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
import { channelsTable } from "@/Utils/Cql/Tables/ChannelTable.ts";
import { guildMembersTable } from "@/Utils/Cql/Tables/GuildMemberTable.ts";
import { permissionsOverridesTable } from "@/Utils/Cql/Tables/PermissionsOverideTable.ts";
import { rolesTable } from "@/Utils/Cql/Tables/RoleTable.ts";
import type { bigintPair } from "@/Utils/Cql/Types/PermissionsOverides.ts";
import PermissionHandler from "@/Utils/Versioning/v1/PermissionCheck.ts";

const postChannel = {
	name: string().max(32).min(2),
	description: string().max(256).optional().nullable(),
	type: enums(
		Object.entries(Constants.channelTypes)
			.filter(([key]) => key.startsWith("Guild"))
			.map(([, value]) => value),
	),
	parentId: snowflake().optional().nullable(),
	permissionOverrides: object(
		{
			type: enums([Constants.permissionOverrideTypes.Member, Constants.permissionOverrideTypes.Role]),
			allow: any().optional().nullable(),
			deny: any().optional().nullable(),
			slowmode: number().min(0).max(86_400).optional(), // ? In seconds
			// TODO: other stuff
		},
		"keyof",
	).optional(),
	slowmode: number().min(0).max(86_400).optional(), // ? In seconds
	ageRestricted: boolean().optional(),
	position: number().optional(),
};

export default class FetchCreateChannels extends Route {
	public constructor(App: API) {
		super(App);
	}

	@Method("get")
	@Description("Change this Description when working on this route")
	@ContentTypes("any")
	public getChannels() {
		return {};
	}

	@Method("post")
	@Description("Create a channel")
	@ContentTypes("any")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: "User",
		}),
	)
	@Middleware(bodyValidator(postChannel))
	public async postChannels({
		body,
		user,
		params,
		set,
	}: CreateRoute<"/guilds/:guildId/channels", Infer<typeof postChannel>, [UserMiddlewareType]>) {
		const invalidGuild = errorGen.UnknownGuild();

		invalidGuild.addError({
			guildId: {
				code: "UnknownGuild",
				message: "The provided guild does not exist, or you do not have access to it.",
			},
		});

		if (!user.guilds.includes(params.guildId)) {
			set.status = 404;

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

			return invalidGuild.toJSON();
		}

		const guildMemberFlags = new GuildMemberFlags(guildMember.flags ?? 0);

		if (!guildMemberFlags.has("In")) {
			set.status = 404;

			return invalidGuild.toJSON();
		}

		const roles = (
			await Promise.all(
				guildMember.roles.map(async (id) =>
					rolesTable.get(
						{ roleId: id, guildId: Encryption.encrypt(params.guildId) },
						{ fields: ["roleId", "permissions", "position"] },
					),
				),
			)
		).filter((rol) => rol !== null);

		const foundParent = body.parentId
			? await channelsTable.get(
					{ channelId: Encryption.encrypt(body.parentId), guildId: Encryption.encrypt(params.guildId) },
					{ fields: ["permissionOverrides"] },
				)
			: null;

		const permissionOverrides = foundParent
			? foundParent.permissionOverrides
				? (
						await Promise.all(
							foundParent.permissionOverrides.map((id) => permissionsOverridesTable.get({ permissionId: id })),
						)
					).filter((perm) => perm !== null)
				: []
			: [];

		const permissionCheck = new PermissionHandler(
			user.id,
			guildMember.flags ?? 0,
			roles.map((role) => ({
				id: role.roleId!,
				permissions: Permissions.permissionFromDatabase(role.permissions as bigintPair[]),
				position: role.position ?? 0,
			})),
			foundParent
				? [
						{
							id: body.parentId!,
							overrides: permissionOverrides.map((perm) => ({
								allow: Permissions.permissionFromDatabase(perm.allow as bigintPair[]),
								deny: Permissions.permissionFromDatabase(perm.deny as bigintPair[]),
								id: perm.permissionId!,
								type: perm.type === Constants.permissionOverrideTypes.Member ? "Member" : "Role",
							})),
						},
					]
				: [],
		);

		if (!body.parentId && !permissionCheck.hasAnyRole(["CreateChannel"])) {
			set.status = 403;

			const missingPermission = errorGen.MissingPermissions();

			missingPermission.addError({
				channel: {
					code: "MissingPermissions",
					message: 'You are missing the "CreateChannel" permission.',
					requiredPermissions: ["CreateChannel"], // ? note: this is a testing field, may be removed later
				},
			});

			return missingPermission.toJSON();
		}

		if (body.parentId && !permissionCheck.hasChannelPermission(body.parentId, ["CreateChannel"])) {
			// ? This is due to the fact you can create specific channels in a category without having the permission to create a channel on a role
			set.status = 403;

			const missingPermission = errorGen.MissingPermissions();

			missingPermission.addError({
				channel: {
					code: "MissingPermissions",
					message: 'You are missing the "CreateChannel" permission.',
					requiredPermissions: ["CreateChannel"], // ? note: this is a testing field, may be removed later
				},
			});

			return missingPermission.toJSON();
		}

		const invalidField = errorGen.InvalidField();

		if (!/^(?!.*--)[a-zA-Z0-9- ]+$/.test(body.name)) {
			set.status = 400;

			invalidField.addError({
				name: {
					code: "InvalidName",
					message: "The name provided was invalid, it must be alphanumeric and can contain spaces and dashes.",
				},
			});
		}

		for (const [key, value] of Object.entries(body.permissionOverrides ?? {})) {
			// ? allow / deny are arrays of arrays of strings (string[][])
			if (value.allow) {
				if (!Array.isArray(value.allow)) {
					set.status = 400;

					invalidField.addError({
						[`permissionOverrides.${key}.allow`]: {
							code: "InvalidType",
							message: "The allow field must be an array of arrays of strings.",
						},
					});

					continue;
				}

				if (
					!value.allow.every((arr) => Array.isArray(arr)) ||
					!value.allow.every((arr) => arr.every((str) => typeof str === "string"))
				) {
					set.status = 400;

					invalidField.addError({
						[`permissionOverrides.${key}.allow`]: {
							code: "InvalidType",
							message: "The allow field must be an array of arrays of strings.",
						},
					});

					continue;
				}

				if (value.allow.some((arr) => arr.length !== 2)) {
					set.status = 400;

					invalidField.addError({
						[`permissionOverrides.${key}.allow`]: {
							code: "InvalidType",
							message: "The allow field must be an array of arrays of strings with 2 elements.",
						},
					});

					continue;
				}
			}

			if (value.deny) {
				if (!Array.isArray(value.deny)) {
					set.status = 400;

					invalidField.addError({
						[`permissionOverrides.${key}.deny`]: {
							code: "InvalidType",
							message: "The deny field must be an array of arrays of strings.",
						},
					});

					continue;
				}

				if (
					!value.deny.every((arr) => Array.isArray(arr)) ||
					!value.deny.every((arr) => arr.every((str) => typeof str === "string"))
				) {
					set.status = 400;

					invalidField.addError({
						[`permissionOverrides.${key}.deny`]: {
							code: "InvalidType",
							message: "The deny field must be an array of arrays of strings.",
						},
					});

					continue;
				}

				if (value.deny.some((arr) => arr.length !== 2)) {
					set.status = 400;

					invalidField.addError({
						[`permissionOverrides.${key}.deny`]: {
							code: "InvalidType",
							message: "The deny field must be an array of arrays of strings with 2 elements.",
						},
					});

					continue;
				}
			}
		}
		
		if (invalidField.hasErrors()) {
			return invalidField.toJSON();
		}

		const channels = await channelsTable.find({
			guildId: Encryption.encrypt(params.guildId),
		})
	}
}
