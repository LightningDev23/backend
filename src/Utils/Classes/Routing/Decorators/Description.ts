import type { Route } from "../Route.ts";

const Description = (description: string) => {
	return (target: Route, propertyKey: string) => {
		target.__descriptions = [
			...(target.__descriptions ?? []),
			{
				name: propertyKey,
				description, // For example: "[GET] Fetch the user's avatar"
			},
		];
	};
};

export default Description;
