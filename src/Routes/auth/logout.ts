import type { UserMiddlewareType } from "@/Middleware/User.ts";
import userMiddleware from "@/Middleware/User.ts";
import type API from "@/Utils/Classes/API.ts";
import Encryption from "@/Utils/Classes/Encryption.ts";
import ContentTypes from "@/Utils/Classes/Routing/Decorators/ContentTypes.ts";
import Description from "@/Utils/Classes/Routing/Decorators/Description.ts";
import Method from "@/Utils/Classes/Routing/Decorators/Method.ts";
import Middleware from "@/Utils/Classes/Routing/Decorators/Middleware.ts";
import type { CreateRoute } from "@/Utils/Classes/Routing/Route.ts";
import Route from "@/Utils/Classes/Routing/Route.ts";

export default class Logout extends Route {
	public constructor(App: API) {
		super(App);
	}

	@Method("delete")
	@Description("Delete the current session")
	@ContentTypes("any")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: "User",
		}),
	)
	public async deleteLogout({ user, set }: CreateRoute<"/logout", any, [UserMiddlewareType]>) {
		const fetched = await this.App.cassandra.models.Settings.get(
			{
				userId: Encryption.encrypt(user.id),
			},
			{
				fields: ["userId", "tokens"],
			},
		);

		if (!fetched) {
			set.status = 500;

			return "Internal Server Error :(";
		}

		const newSettings = fetched;

		newSettings.tokens = newSettings.tokens.filter((token) => token.token !== Encryption.encrypt(user.token));

		await this.App.cassandra.models.Settings.update(newSettings);

		set.status = 204;

		return;
	}
}
