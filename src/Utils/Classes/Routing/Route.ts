import type { StatusMap } from "elysia";
import type { GetParams } from "@/Types/Routes.ts";
import type API from "../API.ts";

type Method = "all" | "delete" | "get" | "head" | "options" | "patch" | "post" | "put";

type ContentTypes =
	| "any"
	| "application/javascript"
	| "application/json"
	| "application/octet-stream"
	| "application/x-www-form-urlencoded"
	| "application/zip"
	| "audio/mpeg"
	| "audio/ogg"
	| "audio/wav"
	| "audio/webm"
	| "image/gif"
	| "image/jpeg"
	| "image/png"
	| "image/webp"
	| "multipart/form-data"
	| "text/html"
	| "text/plain"
	| "video/mp4"
	| "video/ogg"
	| "video/quicktime"
	| "video/webm";

type CreateMiddleware<ExtraOptions extends Record<string, any> | string = Record<string, any>> = ExtraOptions;

interface CreateRouteOptions<
	Route extends string,
	Body extends Record<string, boolean | number | string | null | undefined> | unknown = unknown,
	params extends string[] = [],
	query extends Record<string, string | undefined> = Record<string, string | undefined>,
> {
	app: API;
	body: Body;
	headers: Record<string, string | undefined>;
	ip: string;
	params: GetParams<Route> & ParamsArray<params>;
	path: Route;
	query: query;
	request: globalThis.Request;
	set: {
		headers: Record<string, string> & {
			"Set-Cookie"?: string[] | string;
		};
		redirect?: string;
		status?: number | keyof StatusMap;
	};
	store: {};
}

type MiddlewareArray<Arr extends Record<string, unknown>[]> = Arr extends [infer First, ...infer Rest]
	? First extends Record<string, unknown>
		? Rest extends Record<string, unknown>[]
			? CreateMiddleware<First> & MiddlewareArray<Rest>
			: never
		: never
	: {};

// turn this into an object from an array
type ParamsArray<Arr extends string[]> = Arr extends [infer First, ...infer Rest]
	? First extends string
		? Rest extends string[]
			? ParamsArray<Rest> & Record<First, string>
			: never
		: never
	: {};

type CreateRoute<
	Route extends string = string,
	Body extends Record<string, boolean | number | string | null | undefined> | unknown = unknown,
	MiddlewareSettings extends Record<string, unknown>[] = [],
	params extends string[] = [],
	query extends Record<string, string | undefined> = Record<string, string | undefined>,
> = CreateRouteOptions<Route, Body, params, query> & MiddlewareArray<MiddlewareSettings>;

class Route {
	public readonly App: API;

	public KillSwitched: boolean; // KillSwitched routes will be populated in the routes, though when someone tries to use it, we'll return a 503 error (default is false)

	public constructor(App: API) {
		this.App = App;

		this.KillSwitched = false;
	}
}

interface Decorators {
	__contentTypes: {
		name: string;
		type: ContentTypes[];
	}[];
	__descriptions: {
		// Description of the route method (for documentation)
		description: string;
		name: string;
	}[];
	__methods: { method: Method; name: string }[];
	__middlewares: {
		name: string;
		ware(req: CreateRouteOptions<string, {}>): CreateMiddleware | Promise<CreateMiddleware>;
	}[];
}

interface Route extends Decorators {}

export default Route;

export type { Route, Method, ContentTypes, CreateRouteOptions, CreateRoute, CreateMiddleware };
