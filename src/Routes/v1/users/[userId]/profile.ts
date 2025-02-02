import type { UserMiddlewareType } from "@/Middleware/User.ts";
import userMiddleware from "@/Middleware/User.ts";
import type API from "@/Utils/Classes/API.ts";
import Encryption from "@/Utils/Classes/Encryption.ts";
import errorGen from "@/Utils/Classes/ErrorGen.ts";
import ContentTypes from "@/Utils/Classes/Routing/Decorators/ContentTypes.ts";
import Description from "@/Utils/Classes/Routing/Decorators/Description.ts";
import Method from "@/Utils/Classes/Routing/Decorators/Method.ts";
import Middleware from "@/Utils/Classes/Routing/Decorators/Middleware.ts";
import type { CreateRoute } from "@/Utils/Classes/Routing/Route.ts";
import Route from "@/Utils/Classes/Routing/Route.ts";

// ? Why would we want to have a "profile" route instead of adding it to the normal user route
// ? Great question, the reason is I want it to be the same as the @me route, since the profile meta data is sent in the
// ? Gateway payload for identify, I want to keep it the same as the @me route, so that way I can easily document it

interface ProfileResponse {
	// TODO: Add connections (Discord, Twitter (X), Github, Steam, Spotify (Not sure if we can do this one), Reddit, Youtube, Twitch)
	bio: string | null;
	connections: unknown[];
	mutualFriends: string[];
	mutualGuilds: string[];
}

export default class Profile extends Route {
	public constructor(App: API) {
		super(App);
	}

	@Method("get")
	@Description("Fetch a users profile")
	@ContentTypes("any")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: ["User"],
		}),
	)
	public async getProfile({ params, set, user }: CreateRoute<"/users/:userId/profile", any, [UserMiddlewareType]>) {
		const fetchedUser = await this.App.cassandra.models.User.get(
			{
				userId: Encryption.encrypt(params.userId),
			},
			{
				fields: ["guilds"],
			},
		);

		if (!fetchedUser) {
			const userNotFound = errorGen.InvalidUser();

			userNotFound.addError({
				user: {
					code: "InvalidUser",
					message: "The requested user does not exist, or they have blocked you.",
				},
			});

			set.status = 404;

			return userNotFound.toJSON();
		}

		const settings = await this.App.cassandra.models.Settings.get(
			{
				userId: Encryption.encrypt(params.userId),
			},
			{
				fields: ["bio"],
			},
		);

		const mutualGuilds = user.guilds.filter((guild) => fetchedUser.guilds.includes(Encryption.encrypt(guild)));

		return {
			connections: [],
			mutualFriends: [],
			mutualGuilds,
			bio: settings?.bio ? Encryption.decrypt(settings.bio) : null,
		};
	}
}
