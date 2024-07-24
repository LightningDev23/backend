import type { Method as RequestMethod, Route } from "../Route.ts";

const Method = (Method: RequestMethod) => {
	return (target: Route, propertyKey: string) => {
		target.__methods = [
			...(target.__methods ?? []),
			{
				method: Method,
				name: propertyKey,
			},
		];
	};
};

export default Method;
