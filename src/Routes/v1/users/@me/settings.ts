import { presenceTypes, statusTypes } from "@/Constants.ts";
import bodyValidator from "@/Middleware/BodyValidator.ts";
import type { UserMiddlewareType } from "@/Middleware/User.ts";
import userMiddleware from "@/Middleware/User.ts";
import type { Infer } from "@/Types/BodyValidation.ts";
import { enums, array, number, snowflake, string } from "@/Types/BodyValidation.ts";
import type API from "@/Utils/Classes/API.ts";
import Encryption from "@/Utils/Classes/Encryption.ts";
import errorGen from "@/Utils/Classes/ErrorGen.ts";
import ContentTypes from "@/Utils/Classes/Routing/Decorators/ContentTypes.ts";
import Description from "@/Utils/Classes/Routing/Decorators/Description.ts";
import Method from "@/Utils/Classes/Routing/Decorators/Method.ts";
import Middleware from "@/Utils/Classes/Routing/Decorators/Middleware.ts";
import type { CreateRoute } from "@/Utils/Classes/Routing/Route.ts";
import Route from "@/Utils/Classes/Routing/Route.ts";

const patchSettings = {
	customStatus: string().optional().nullable().max(128),
	theme: enums(["dark", "light", "system"]).optional(), // dark, light, auto
	language: enums(["en-US"]).optional(), // en-US
	guildOrder: array({
		guildId: snowflake(),
		position: number().min(0).max(100),
	})
		.max(100)
		.optional(),
	bio: string().optional().max(300),
	emojiPack: enums(["fluentui-emoji", "native", "noto-emoji", "twemoji"]).optional(),
	navBarLocation: enums(["bottom", "left"]).optional(),
};

export default class UserSettings extends Route {
	public constructor(App: API) {
		super(App);
	}

	@Method("get")
	@Description("Fetch the current users settings")
	@ContentTypes("any")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: "User",
		}),
	)
	public async getSettings({ user }: CreateRoute<"/@me/settings", {}, [UserMiddlewareType]>) {
		return user.settings;
	}

	@Method("patch")
	@Description("Update the current users settings")
	@ContentTypes("application/json")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: "User",
		}),
	)
	@Middleware(bodyValidator(patchSettings))
	public async patchSettings({
		user,
		body,
	}: CreateRoute<"/@me/settings", Infer<typeof patchSettings>, [UserMiddlewareType]>) {
		const failedToUpdateSettigns = errorGen.FailedToPatchUser();

		const data: Partial<Infer<typeof patchSettings> & { navLocation?: "bottom" | "left" }> = {};

		if (body.theme) {
			data.theme = body.theme;
		}

		if (body.language) {
			data.language = body.language;
		}

		if (body.customStatus !== undefined) {
			data.customStatus = body.customStatus ? Encryption.encrypt(body.customStatus) : null;
		}

		if (body.bio) {
			data.bio = Encryption.encrypt(body.bio);
		}

		if (body.emojiPack) {
			data.emojiPack = body.emojiPack;
		}

		if (body.navBarLocation) {
			data.navLocation = body.navBarLocation;
		}

		const fixedGuilds = body.guildOrder;

		if (fixedGuilds) {
			for (const guild of fixedGuilds) {
				if (!user.guilds.includes(guild.guildId)) {
					failedToUpdateSettigns.addError({
						[`guildOrder.${guild.guildId}`]: {
							code: "InvalidGuild",
							message: "The guild you provided was invalid, you are not in that guild",
						},
					});
				} else if (guild.position < 0 || guild.position > user.guilds.length) {
					failedToUpdateSettigns.addError({
						[`guildOrder.${guild.guildId}`]: {
							code: "InvalidPosition",
							message: "The position you provided was invalid",
						},
					});
				}
			}

			// TODO: fix the guild positions i.e if the user sends 0, 3, 8 fix it to 0, 1, 2
			// TODO: and if theres any duplicates set them to the next position then push the rest back
		}

		if (failedToUpdateSettigns.hasErrors()) {
			return failedToUpdateSettigns;
		}

		if (Object.keys(data).length > 0) {
			await this.App.cassandra.models.Settings.update({
				userId: Encryption.encrypt(user.id),
				...data,
			});
		}

		if (body.customStatus !== undefined) {
			const fetchedPresence = await this.App.cache.get(`user:${Encryption.encrypt(user.id)}`);
			const parsedPresence = JSON.parse(
				(fetchedPresence as string) ??
					`[{ "sessionId": null, "since": null, "state": null, "type": ${presenceTypes.custom}, "status": ${statusTypes.offline} }]`,
			) as { sessionId: string | null; since: number | null; state: string | null; status: number; type: number }[];

			for (const presence of parsedPresence) {
				if (presence.type === presenceTypes.custom) {
					presence.state = body.customStatus;
				}
			}

			const usr = await this.App.cassandra.models.User.get(
				{
					userId: Encryption.encrypt(user.id),
				},
				{
					fields: ["avatar"],
				},
			);

			for (const guild of user.guilds) {
				this.App.rabbitMQForwarder("presence.update", {
					user: {
						id: user.id,
						username: user.username,
						avatar: usr!.avatar,
						publicFlags: user.flagsUtil.PublicFlags.cleaned,
						flags: user.flagsUtil.PrivateFlags.cleaned,
					},
					guildId: guild,
					presences: parsedPresence,
					guilds: user.guilds,
				});
			}

			await this.App.cache.set(`user:${Encryption.encrypt(user.id)}`, JSON.stringify(parsedPresence));
		}

		return {
			...user.settings,
			bio: body.bio ?? user.settings.bio,
			guildOrder: fixedGuilds ?? user.settings.guildOrder,
			language: body.language ?? user.settings.language,
			privacy: user.settings.privacy,
			customStatus: body.customStatus ?? user.settings.customStatus,
			theme: body.theme ?? user.settings.theme,
			emojiPack: body.emojiPack ?? user.settings.emojiPack ?? "twemoji",
			navBarLocation: body.navBarLocation ?? user.settings.navBarLocation ?? "bottom",
		};
	}
}
