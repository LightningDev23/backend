import type { KeyObject } from "node:crypto";
import { generateKeySync } from "node:crypto";
import { presenceTypes, statusTypes } from "@/Constants.example.ts";
import Constants from "@/Constants.ts";
import type { UserMiddlewareType } from "@/Middleware/User.ts";
import userMiddleware from "@/Middleware/User.ts";
import type API from "@/Utils/Classes/API.ts";
import FlagFields from "@/Utils/Classes/BitFields/Flags.ts";
import GuildMemberFlags from "@/Utils/Classes/BitFields/GuildMember.ts";
import Encryption from "@/Utils/Classes/Encryption.ts";
import errorGen from "@/Utils/Classes/ErrorGen.ts";
import ContentTypes from "@/Utils/Classes/Routing/Decorators/ContentTypes.ts";
import Description from "@/Utils/Classes/Routing/Decorators/Description.ts";
import Method from "@/Utils/Classes/Routing/Decorators/Method.ts";
import Middleware from "@/Utils/Classes/Routing/Decorators/Middleware.ts";
import type { CreateRoute } from "@/Utils/Classes/Routing/Route.ts";
import Route from "@/Utils/Classes/Routing/Route.ts";
import type { finishedGuild } from "../guilds/index.ts";
import { guildsTable } from "@/Utils/Cql/Tables/GuildTable.ts";
import { channelsTable } from "@/Utils/Cql/Tables/ChannelTable.ts";
import { usersTable } from "@/Utils/Cql/Tables/UserTable.ts";
import { invitesTable } from "@/Utils/Cql/Tables/InviteTable.ts";
import { guildMembersTable, type GuildMemberTable } from "@/Utils/Cql/Tables/GuildMemberTable.ts";
import type { NullifyStuff } from "@/Utils/Classes/DB/createTableTypes.ts";

export default class FetchJoinInvite extends Route {
	public randomKey = generateKeySync("aes", { length: 256 });

	public constructor(App: API) {
		super(App);
	}

	@Method("get")
	@Description("Fetch the invite code")
	@ContentTypes("any")
	public async getInviteCode({
		params,
		set,
		key,
	}: CreateRoute<"/invites/:inviteCode"> & {
		key: KeyObject;
	}) {
		if (key && !this.randomKey.equals(key)) {
			set.status = 500;

			return "Internal Server Error :("; // ? its a user, not the server
		}

		const inviteExists = await invitesTable.get({
			code: Encryption.encrypt(params.inviteCode),
		});

		const invalidInvite = errorGen.InvalidInvite();

		if (!inviteExists) {
			invalidInvite.addError({
				invite: {
					code: "InvalidInvite",
					message: "The invite code is invalid or has expired.",
				},
			});

			set.status = 404;

			return invalidInvite.toJSON();
		}

		if (inviteExists.expires && inviteExists.expires.getTime() < Date.now()) {
			invalidInvite.addError({
				invite: {
					code: "InvalidInvite",
					message: "The invite code is invalid or has expired.",
				},
			});

			set.status = 404;

			await invitesTable.remove({
				code: Encryption.encrypt(params.inviteCode),
				guildId: inviteExists.guildId!,
			});

			return invalidInvite.toJSON();
		}

		if (
			inviteExists.maxUses &&
			inviteExists.uses &&
			inviteExists.maxUses !== 0 &&
			inviteExists.uses >= inviteExists.maxUses
		) {
			invalidInvite.addError({
				invite: {
					code: "InvalidInvite",
					message: "The invite code is invalid or has expired.",
				},
			});

			set.status = 404;

			await invitesTable.remove({
				code: Encryption.encrypt(params.inviteCode),
				guildId: inviteExists.guildId!,
			});

			return invalidInvite.toJSON();
		}

		const fetchedGuild = await guildsTable.get(
			{
				guildId: inviteExists.guildId!,
			},
			{
				fields: ["members", "ownerId", "name", "icon", "features"],
			},
		);

		if (!fetchedGuild) {
			invalidInvite.addError({
				invite: {
					code: "InvalidInvite",
					message: "The invite code is invalid or has expired.",
				},
			});

			set.status = 404;

			return invalidInvite.toJSON();
		}

		const foundChannel = await channelsTable.get(
			{
				channelId: inviteExists.channelId!,
			},
			{
				fields: ["name", "type", "description"],
			},
		);

		const creator = await usersTable.get(
			{
				userId: inviteExists.creatorId!,
			},
			{
				fields: ["avatar", "globalNickname", "publicFlags", "tag", "userId", "username", "flags"],
			},
		);

		return Encryption.completeDecryption({
			type: inviteExists.type,
			code: inviteExists.code,
			guild: key
				? fetchedGuild
				: {
						id: inviteExists.guildId,
						name: fetchedGuild.name,
						icon: fetchedGuild.icon,
						ownerId: fetchedGuild.ownerId,
						features: fetchedGuild.features ?? [],
						memberCount: fetchedGuild.members,
					},
			channel: {
				id: inviteExists.channelId,
				name: foundChannel?.name,
				type: foundChannel?.type,
				description: foundChannel?.description,
			},
			creator: creator
				? {
						id: creator.userId,
						avatar: creator.avatar,
						globalNickname: creator.globalNickname,
						username: creator.username,
						tag: creator.tag,
						publicFlags: creator.publicFlags,
						flags: FlagFields.cleanPrivateFlags(creator.flags ?? "0"),
					}
				: null,
			uses: inviteExists.uses,
			maxUses: inviteExists.maxUses,
			expiresAt: inviteExists.expires,
		});
	}

	@Method("post")
	@Description("Join the guild from the invite code")
	@ContentTypes("any")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: "User",
		}),
	)
	public async postInviteCode({ params, user, set }: CreateRoute<"/invites/:inviteCode", any, [UserMiddlewareType]>) {
		const canJoin = this.canJoinGuild(user.flagsUtil, user.guilds.length);

		if (!canJoin.can) {
			const maxGuild = errorGen.LimitReached();

			maxGuild.addError({
				guild: {
					code: "MaxGuildsReached",
					message: `You've created or joined the max amount of guilds, you can only have "${canJoin.max}" guilds.`,
				},
			});

			set.status = 403;

			return maxGuild.toJSON();
		}

		const inviteExists = await invitesTable.get({
			code: Encryption.encrypt(params.inviteCode),
		});

		const invalidInvite = errorGen.InvalidInvite();

		if (!inviteExists) {
			invalidInvite.addError({
				invite: {
					code: "InvalidInvite",
					message: "The invite code is invalid or has expired.",
				},
			});

			set.status = 404;

			return invalidInvite.toJSON();
		}

		if (inviteExists.expires && inviteExists.expires.getTime() < Date.now()) {
			invalidInvite.addError({
				invite: {
					code: "InvalidInvite",
					message: "The invite code is invalid or has expired.",
				},
			});

			set.status = 404;

			await invitesTable.remove({
				code: Encryption.encrypt(params.inviteCode),
				guildId: inviteExists.guildId!,
			});

			return invalidInvite.toJSON();
		}

		if (
			inviteExists.maxUses &&
			inviteExists.uses &&
			inviteExists.maxUses !== 0 &&
			inviteExists.uses >= inviteExists.maxUses
		) {
			invalidInvite.addError({
				invite: {
					code: "InvalidInvite",
					message: "The invite code is invalid or has expired.",
				},
			});

			set.status = 404;

			await invitesTable.remove({
				code: Encryption.encrypt(params.inviteCode),
				guildId: inviteExists.guildId!,
			});

			return invalidInvite.toJSON();
		}

		const member =
			(await guildMembersTable.get({
				userId: Encryption.encrypt(user.id),
				guildId: inviteExists.guildId!,
				left: false,
			})) ??
			(await guildMembersTable.get({
				userId: Encryption.encrypt(user.id),
				guildId: inviteExists.guildId!,
				left: true,
			}));

		if (member) {
			const memberFlags = new GuildMemberFlags(member.flags ?? 0);

			if (memberFlags.has("Banned")) {
				const banned = errorGen.InvalidInvite();

				banned.addError({
					guild: {
						code: "Banned",
						message: "You're banned from this guild.",
					},
				});

				set.status = 403;

				return banned.toJSON();
			}

			if (memberFlags.has("In")) {
				const alreadyIn = errorGen.InvalidInvite();

				alreadyIn.addError({
					guild: {
						code: "AlreadyIn",
						message: "You're already in this guild.",
					},
				});

				set.status = 403;

				return alreadyIn.toJSON();
			}

			if (memberFlags.hasOneArray(["Left", "Kicked"])) {
				await guildMembersTable.remove({
					guildId: inviteExists.guildId!,
					left: true,
					guildMemberId: member.guildMemberId!,
				});
			}
		}

		const newMember: NullifyStuff<GuildMemberTable> = {
			flags: Constants.guildMemberFlags.In,
			guildId: inviteExists.guildId!,
			guildMemberId: BigInt(this.App.snowflake.generate()),
			joinedAt: new Date(),
			nickname: null,
			roles: [inviteExists.guildId!],
			timeouts: [],
			userId: Encryption.encrypt(user.id),
			channelAcks: [],
			left: false,
			timeoutUntil: null,
		};

		await guildMembersTable.insert(newMember);

		await invitesTable.update(
			{
				code: Encryption.encrypt(params.inviteCode),
				guildId: inviteExists.guildId!,
			},
			{
				uses: (inviteExists.uses ?? 0) + 1,
			},
		);

		await usersTable.update(
			{
				userId: Encryption.encrypt(user.id),
			},
			{
				guilds: Encryption.completeEncryption(user.guilds).concat(inviteExists.guildId!),
			},
		);

		// @ts-expect-error -- This is fine
		const fetchedInvite = await this.getInviteCode({
			params,
			set,
			key: this.randomKey,
		});

		if (set.status !== 200 || typeof fetchedInvite === "string") {
			return fetchedInvite;
		}

		this.App.rabbitMQForwarder("guild.create", {
			userId: user.id,
			guild: Encryption.completeDecryption((fetchedInvite as { guild: finishedGuild }).guild),
			member: Encryption.completeDecryption(newMember),
		});

		this.App.rabbitMQForwarder("guildMember.add", {
			userId: user.id,
			guildId: Encryption.decrypt(inviteExists.guildId!),
			member: Encryption.completeDecryption({
				...newMember,
				owner: false,
			}),
		});

		const first100Members = (
			await guildMembersTable.find(
				{ guildId: inviteExists.guildId!, left: false },
				{ limit: 100, fields: ["userId", "nickname", "roles", "joinedAt"] },
			)
		).toArray();

		const finishedGuild = (fetchedInvite as { guild: finishedGuild }).guild;

		const members: unknown[] = [];

		for (const member of Encryption.completeDecryption(first100Members)) {
			const fetchedUser = await usersTable.get(
				{ userId: Encryption.encrypt(member.userId!) },
				{ fields: ["username", "userId", "flags", "publicFlags", "avatar", "tag"] },
			);

			if (!fetchedUser) {
				this.App.logger.warn(`User not found for ${member.userId} in ${finishedGuild.id}`);

				continue;
			}

			const data = {
				user: {
					username: fetchedUser.username,
					id: fetchedUser.userId,
					flags: FlagFields.cleanPrivateFlags(fetchedUser.flags ?? "0"),
					publicFlags: fetchedUser.publicFlags,
					avatar: fetchedUser.avatar,
					tag: fetchedUser.tag,
				},
				owner: finishedGuild.owner?.id === member.userId,
				nickname: member.nickname,
				roles: member.roles,
				joinedAt: member.joinedAt!.toISOString(),
				presence: [],
			};

			const fetchedPresence = await this.App.cache.get(`user:${fetchedUser.userId}`);
			const parsedPresence = JSON.parse(
				(fetchedPresence as string) ??
					`[{ "sessionId": null, "since": null, "state": null, "type": ${presenceTypes.custom}, "status": ${statusTypes.offline} }]`,
			) as { sessionId: string | null; since: number | null; state: string | null; status: number; type: number }[];

			// @ts-expect-error -- it's fine
			data.presence = parsedPresence.map((pre) => ({
				...pre,
				sessionId: undefined,
				current: undefined,
			}));

			members.push(data);
		}

		this.App.rabbitMQForwarder("guildMember.chunk", {
			userId: user.id,
			guildId: finishedGuild.id,
			members,
		});

		return {
			...fetchedInvite,
			guild: {
				// ? it should be the same as if they didn't provide the key
				id: Encryption.decrypt(inviteExists.guildId!),
				name: (fetchedInvite as { guild: finishedGuild }).guild.name,
				icon: (fetchedInvite as { guild: finishedGuild }).guild.icon,
				ownerId: (fetchedInvite as { guild: finishedGuild }).guild.ownerId,
				features: (fetchedInvite as { guild: finishedGuild }).guild.features ?? [],
			},
		};
	}

	public canJoinGuild(flags: FlagFields, guildCount: number) {
		if (flags.has("IncreasedGuildCount100") && guildCount < 100) {
			return {
				can: true,
				max: 100,
			};
		}

		if (flags.has("IncreasedGuildCount200") && guildCount < 200) {
			return {
				can: true,
				max: 200,
			};
		}

		if (flags.has("IncreasedGuildCount500") && guildCount < 500) {
			return {
				can: true,
				max: 500,
			};
		}

		if (
			(!flags.has("IncreasedGuildCount100") ||
				!flags.has("IncreasedGuildCount200") ||
				!flags.has("IncreasedGuildCount500")) &&
			guildCount < Constants.settings.Max.GuildCount
		) {
			return {
				can: true,
				max: Constants.settings.Max.GuildCount,
			};
		}

		return {
			can: false,
			max: flags.has("IncreasedGuildCount100")
				? 100
				: flags.has("IncreasedGuildCount200")
					? 200
					: flags.has("IncreasedGuildCount500")
						? 500
						: Constants.settings.Max.GuildCount,
		};
	}
}
