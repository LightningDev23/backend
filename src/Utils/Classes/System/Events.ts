import { OpCodes } from '../WsUtils';
import type { SystemSocket } from './SystemSocket';

class Events {
	SendEvents: boolean;

	constructor(private readonly SystemSocket: SystemSocket) {
		this.SystemSocket = SystemSocket;

		this.SendEvents = true;
	}

	MessageCreate(Message: {
		AllowedMentions: number;
		Author: {
			Id: string;
			JoinedAt: number;
			Nickname: string | null;
			Roles: string[];
			User: {
				AvatarHash: string | null;
				Flags: number;
				Id: string;
				PublicFlags: number;
				Tag: string;
				Username: string;
			};
		};
		ChannelId: string;
		Content: string;
		CreatedAt: number;
		Flags: number;
		Id: string;
		Nonce: null;
		UpdatedAt: number;
	}) {
		if (this.SendEvents) {
			this.SystemSocket.Ws?.send(
				JSON.stringify({
					op: OpCodes.MessageCreate,
					d: {
						Message,
					},
				}),
			);
		}

		return JSON.stringify({
			op: OpCodes.MessageCreate,
			d: {
				Message,
			},
		});
	}

	MessageDelete(Message: { AuthorId: string; ChannelId: string; Id: string; Timestamp: number }) {
		if (this.SendEvents) {
			this.SystemSocket.Ws?.send(
				JSON.stringify({
					op: OpCodes.MessageDelete,
					d: {
						Message,
					},
				}),
			);
		}

		return JSON.stringify({
			op: OpCodes.MessageDelete,
			d: {
				Message,
			},
		});
	}

	MessageUpdate(Message: {
		AllowedMentions: number;
		Author: {
			Id: string;
			JoinedAt: number;
			Nickname: string | null;
			Roles: string[];
			User: {
				AvatarHash: string | null;
				Id: string;
				PublicFlags: number;
				Tag: string;
				Username: string;
			};
		};
		ChannelId: string;
		Content: string;
		CreatedAt: number;
		Flags: number;
		Id: string;
		Nonce: string;
		UpdatedAt: number;
	}) {
		if (this.SendEvents) {
			this.SystemSocket.Ws?.send(
				JSON.stringify({
					op: OpCodes.MessageUpdate,
					d: {
						Message,
					},
				}),
			);
		}

		return JSON.stringify({
			op: OpCodes.MessageUpdate,
			d: {
				Message,
			},
		});
	}
}

export default Events;

export { Events };
