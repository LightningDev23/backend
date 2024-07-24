import type { Event } from "../Event.ts";

const OpCode = (code: number) => {
	return (target: Event, propertyKey: string) => {
		target.__opcodes = [
			...(target.__opcodes ?? []),
			{
				name: propertyKey,
				code,
			},
		];
	};
};

export default OpCode;
