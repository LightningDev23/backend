import type { InternalRequest } from "@/Types/InternalRoute.ts";
import type { MySchema } from "@/Types/JsonSchemaType.ts";
import type { GetChannelTypes, channels } from "./Classes/Shared/RabbitMQ.ts";

const isImportant = (data: unknown): data is { data: unknown; type: string } => {
	if (typeof data !== "object") {
		return false;
	}

	if (data === null) {
		return false;
	}

	if (!("type" in data)) {
		return false;
	}

	if (typeof data.type !== "string") {
		return false;
	}

	return "data" in data;
};

const isLog = (data: unknown): data is { data: { file: "error" | "latest"; message: string[] }; type: "log" } => {
	if (!isImportant(data)) {
		return false;
	}

	if (data.type !== "log") {
		return false;
	}

	return "data" in data;
};

const isNewLog = (data: unknown): data is { data: string[]; type: "newLog" } => {
	if (!isImportant(data)) {
		return false;
	}

	if (data.type !== "newLog") {
		return false;
	}

	return "data" in data;
};

const isQuestion = (data: unknown): data is { nonce: string; question: string } => {
	if (typeof data !== "object") {
		return false;
	}

	if (data === null) {
		return false;
	}

	if (!("nonce" in data)) {
		return false;
	}

	if (typeof data.nonce !== "string") {
		return false;
	}

	return "question" in data;
};

const isReady = (data: unknown): data is { data: { port: number | string }; type: "ready" } => {
	if (!isImportant(data)) {
		return false;
	}

	if (data.type !== "ready") {
		return false;
	}

	return "data" in data;
};

const isConfigResponse = (data: unknown): data is { data: MySchema; type: "config" } => {
	if (!isImportant(data)) {
		return false;
	}

	if (data.type !== "config") {
		return false;
	}

	return "data" in data;
};

const isRabbitMqType = (
	data: unknown,
): data is { data: { data: unknown; raw: boolean; topic: GetChannelTypes<typeof channels> }; type: "rabbitMQ" } => {
	if (!isImportant(data)) {
		return false;
	}

	if (data.type !== "rabbitMQ") {
		return false;
	}

	if (!("data" in data)) {
		return false;
	}

	if (typeof data.data !== "object") {
		return false;
	}

	if (data.data === null) {
		return false;
	}

	return "topic" in data.data;
};

const isHeartbeatMessage = (
	data: unknown,
): data is { data: { data: { interval?: number; sessionId: string }; event: string }; type: "heartbeat" } => {
	if (typeof data !== "object") {
		return false;
	}

	if (data === null) {
		return false;
	}

	if (!("type" in data)) {
		return false;
	}

	if (typeof data.type !== "string") {
		return false;
	}

	if (data.type !== "heartbeat") {
		return false;
	}

	return "data" in data;
};

const isInternalRoutingRequest = (data: unknown): data is InternalRequest => {
	if (typeof data !== "object") {
		return false;
	}

	if (data === null) {
		return false;
	}

	if (!("method" in data)) {
		return false;
	}

	if (typeof data.method !== "string") {
		return false;
	}

	if (!("nonce" in data)) {
		return false;
	}

	if (typeof data.nonce !== "string") {
		return false;
	}

	if (!("route" in data)) {
		return false;
	}

	if (typeof data.route !== "string") {
		return false;
	}

	return "version" in data && typeof data.version === "number";
};

export {
	isImportant,
	isLog,
	isNewLog,
	isQuestion,
	isReady,
	isConfigResponse,
	isRabbitMqType,
	isHeartbeatMessage,
	isInternalRoutingRequest,
};
