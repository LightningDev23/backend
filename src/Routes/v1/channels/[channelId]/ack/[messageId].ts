import Constants from "@/Constants.ts";
import type { UserMiddlewareType } from "@/Middleware/User.ts";
import userMiddleware from "@/Middleware/User.ts";
import type FetchCreateMessages from "@/Routes/v1/channels/[channelId]/messages/index.ts";
import type API from "@/Utils/Classes/API.ts";
import GuildMemberFlags from "@/Utils/Classes/BitFields/GuildMember.ts";
import { FlagUtils } from "@/Utils/Classes/BitFields/NewFlags.ts";
import Encryption from "@/Utils/Classes/Encryption.ts";
import errorGen from "@/Utils/Classes/ErrorGen.ts";
import ContentTypes from "@/Utils/Classes/Routing/Decorators/ContentTypes.ts";
import Description from "@/Utils/Classes/Routing/Decorators/Description.ts";
import Method from "@/Utils/Classes/Routing/Decorators/Method.ts";
import Middleware from "@/Utils/Classes/Routing/Decorators/Middleware.ts";
import type { CreateRoute } from "@/Utils/Classes/Routing/Route.ts";
import Route from "@/Utils/Classes/Routing/Route.ts";
import { channelsTable } from "@/Utils/Cql/Tables/ChannelTable.ts";
import { guildMembersTable } from "@/Utils/Cql/Tables/GuildMemberTable.ts";
import { settingsTable } from "@/Utils/Cql/Tables/SettingsTable.ts";

export default class AckingIDBased extends Route {
	public constructor(App: API) {
		super(App);
	}

	@Method("post")
	@Description("Ack the messages in a channel")
	@ContentTypes("any")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: "User",
		}),
	)
	public async ack({ params, set, user }: CreateRoute<"/:channelId/ack/:messageId", any, [UserMiddlewareType]>) {
		const channel = await channelsTable.get(
			{
				channelId: Encryption.encrypt(params.channelId),
			},
			{
				fields: ["type", "guildId"],
			},
		);

		const unknownChannel = errorGen.UnknownChannel();

		if (!channel) {
			set.status = 404;

			unknownChannel.addError({
				channel: {
					code: "UnknownChannel",
					message: "The provided channel does not exist or you do not have access to it.",
				},
			});

			return unknownChannel.toJSON();
		}

		const channelFlags = new FlagUtils(channel.type ?? 0, Constants.channelTypes);

		if (channelFlags.hasOneArray(["Dm", "GroupChat"])) {
			// todo: other logic here later

			set.status = 500;

			return "Internal Server Error :(";
		}

		const guildMember = await guildMembersTable.get(
			{
				guildId: channel.guildId!,
				userId: Encryption.encrypt(user.id),
				left: false,
			},
			{
				fields: ["flags", "channelAcks", "guildMemberId"],
			},
		);

		if (!guildMember) {
			set.status = 404;

			unknownChannel.addError({
				channel: {
					code: "UnknownChannel",
					message: "The provided channel does not exist or you do not have access to it.",
				},
			});

			return unknownChannel.toJSON();
		}

		const guildMemberFlags = new GuildMemberFlags(guildMember.flags ?? 0);

		if (!guildMemberFlags.has("In")) {
			set.status = 404;

			unknownChannel.addError({
				channel: {
					code: "UnknownChannel",
					message: "The provided channel does not exist or you do not have access to it.",
				},
			});

			return unknownChannel.toJSON();
		}

		let lastAckedMessageId: string | null = params?.messageId;

		const messageFetcher = this.App.routeCache.get(this.App.router.match("/v1/channels/123/messages")!.filePath)
			?.routeClass as FetchCreateMessages;

		if (!lastAckedMessageId) {
			lastAckedMessageId = await messageFetcher.getLastMessageId(params.channelId);
		}

		const userSettings = await settingsTable.get(
			{
				userId: Encryption.encrypt(user.id),
			},
			{
				fields: ["mentions"],
			},
		);

		if (userSettings?.mentions) {
			await settingsTable.update(
				{
					userId: Encryption.encrypt(user.id),
				},
				{
					mentions: userSettings.mentions.filter(
						(mention) => mention.channelId !== Encryption.encrypt(params.messageId),
					) as { channelId: string; messageId: string; count: number }[],
				},
			);
		}

		const acks = guildMember.channelAcks ?? [];

		const foundAck = acks.find((ack) => ack.channelId === Encryption.encrypt(params.channelId));

		if (foundAck) {
			foundAck.messageId = lastAckedMessageId ? Encryption.encrypt(lastAckedMessageId) : null;
		} else {
			acks.push({
				channelId: Encryption.encrypt(params.channelId),
				messageId: lastAckedMessageId ? Encryption.encrypt(lastAckedMessageId) : null,
			});
		}

		this.App.rabbitMQForwarder("message.ack", {
			channelId: params.channelId,
			messageId: lastAckedMessageId,
		});

		await guildMembersTable.update(
			{
				guildId: channel.guildId!,
				left: false,
				guildMemberId: guildMember.guildMemberId!,
			},
			{
				channelAcks: acks as { channelId: string; messageId: string }[],
			},
		);

		set.status = 204;

		return;
	}
}
