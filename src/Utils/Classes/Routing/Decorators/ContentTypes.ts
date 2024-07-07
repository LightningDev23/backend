import type { ContentTypes as RequestContentTypes, Route } from "../Route.ts";

const ContentTypes = (ContentTypes: RequestContentTypes | RequestContentTypes[]) => {
	return (target: Route, propertyKey: string) => {
		target.__contentTypes = [
			...(target.__contentTypes ?? []),
			{
				type: Array.isArray(ContentTypes) ? ContentTypes : [ContentTypes],
				name: propertyKey,
			},
		];
	};
};

export default ContentTypes;
