import type WebSocket from "@/Utils/Classes/WebSocket";
import type { ChannelCreate } from "../../Types/channel/create";

const isChannelPayload = (data: unknown): data is ChannelCreate => {
	if (typeof data !== "object" || data === null || data === undefined) {
		return false;
	}

	if (!("ageRestricted" in data)) {
		return false;
	}
	if (!("allowedMentions" in data)) {
		return false;
	}
	if (!("channelId" in data)) {
		return false;
	}
	if (!("children" in data)) {
		return false;
	}
	if (!("description" in data)) {
		return false;
	}
	if (!("guildId" in data)) {
		return false;
	}
	if (!("name" in data)) {
		return false;
	}
	if (!("parentId" in data)) {
		return false;
	}
	if (!("permissionOverrides" in data)) {
		return false;
	}
	if (!("position" in data)) {
		return false;
	}
	if (!("slowmode" in data)) {
		return false;
	}
	return Boolean(!("type" in data));
};

const channelDelete = (ws: WebSocket, data: unknown) => {
	if (!isChannelPayload(data)) {
		ws.logger.debug("Invalid channelDelete Payload");
	}

	return ws.logger.debug(data);
};

export { channelDelete };
