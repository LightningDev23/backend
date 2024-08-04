import bodyValidator from "@/Middleware/BodyValidator.ts";
import userMiddleware, { type UserMiddlewareType } from "@/Middleware/User.ts";
import { any, type Infer, string } from "@/Types/BodyValidation.ts";
import type API from "@/Utils/Classes/API.ts";
import ContentTypes from "@/Utils/Classes/Routing/Decorators/ContentTypes.ts";
import Description from "@/Utils/Classes/Routing/Decorators/Description.ts";
import Method from "@/Utils/Classes/Routing/Decorators/Method.ts";
import Middleware from "@/Utils/Classes/Routing/Decorators/Middleware.ts";
import Route, { type CreateRoute } from "@/Utils/Classes/Routing/Route.ts";

const modifyMemberBody = {
	nickname: string().optional().nullable().max(32),
	roles: any().optional(),
};

export default class FetchPatchMember extends Route {
	public constructor(App: API) {
		super(App);
	}

	@Method("get")
	@Description("Change this Description when working on this route")
	@ContentTypes("application/json")
	public getMember() {
		return {};
	}

	@Method("patch")
	@Description("Change this Description when working on this route")
	@ContentTypes("application/json")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: "User",
		}),
	)
	@Middleware(bodyValidator(modifyMemberBody))
	public patchMember({
		user,
		params,
		set,
		body,
	}: CreateRoute<"/:guildId/members/:memberId", Infer<typeof modifyMemberBody>, [UserMiddlewareType]>) {
		return {};
	}
}
