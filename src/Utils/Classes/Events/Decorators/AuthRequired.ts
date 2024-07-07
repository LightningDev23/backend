import type { Event } from "../Event.ts";

const AuthRequired = (isRequired = true) => {
	return (target: Event, propertyKey: string) => {
		target.__authRequired = [
			...(target.__authRequired ?? []),
			{
				name: propertyKey,
				auth: isRequired,
			},
		];
	};
};

export default AuthRequired;
