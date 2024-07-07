import type { BodyValidator } from "@/Types/BodyValidation.ts";
import type { Event } from "../Event.ts";

const Validator = (data: BodyValidator) => {
	return (target: Event, propertyKey: string) => {
		target.__validator = [
			...(target.__validator ?? []),
			{
				name: propertyKey,
				body: data,
			},
		];
	};
};

export default Validator;
