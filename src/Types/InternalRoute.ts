import type { UserMiddlewareType } from "@/Middleware/User.ts";
import type { Method } from "@/Utils/Classes/Routing/Route.ts";

export interface InternalRequest {
	method: Method;
	nonce: string;
	route: string;
	user?: UserMiddlewareType;
	version: number;
}

export interface InternalRequestResponse {
	data: unknown;
	nonce: string;
	ok: boolean;
	status: number;
}
