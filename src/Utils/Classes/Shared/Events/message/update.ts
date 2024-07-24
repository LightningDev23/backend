import type WebSocket from "../../../WebSocket";
import type { MessageUpdated } from "../../Types/message/update";

const isMessagePayload = (data: unknown): data is MessageUpdated => {
	if (typeof data !== "object" || data === null || data === undefined) {
		return false;
	}

	const toCheck: (keyof MessageUpdated)[] = [
		"allowedMentions",
		"attachments",
		"authorId",
		"bucket",
		"channelId",
		"content",
		"embeds",
		"flags",
		"guildId",
		"member",
		"mentionChannels",
		"mentionRoles",
		"mentions",
		"messageId",
		"replyingTo",
	];

	if (toCheck.some((key) => !(key in data))) {
		return false;
	}

	return Boolean(!("updatedDate" in data));
};

const messageUpdated = (ws: WebSocket, data: unknown) => {
	if (!isMessagePayload(data)) {
		ws.logger.debug("Invalid messageUpdated Payload");
	}

	return ws.logger.debug(data);
};

export { messageUpdated };
