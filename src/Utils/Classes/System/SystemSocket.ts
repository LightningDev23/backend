/* eslint-disable id-length */
import type { Buffer } from "node:buffer";
import zlib from "node:zlib";
import { WebSocket } from "ws";
import Config from "../../../Config.ts";
import type { AuthedPayload, NormalPayload } from "../../../Types/Socket/MiscPayloads";
import type App from "../App.ts";
import { OpCodes, SystemOpCodes } from "../WsUtils.ts";
import Events from "./Events.ts";

class SystemSocket {
	public Ws: WebSocket | null;

	public Sequence: number;

	public HeartbeatInterval: Timer | null;

	public LastHeartbeat: number | null;

	public LastHeartbeatAck: number | null;

	public SessionId: string | null;

	public ApproximateMembers: number;

	public FailedConnectionAttempts: number;

	public Events: Events;

	public App: App;

	private Resolved: boolean;

	public constructor(App: App) {
		this.App = App;

		this.Ws = null;

		this.Sequence = 0;

		this.HeartbeatInterval = null;

		this.LastHeartbeat = null;

		this.LastHeartbeatAck = null;

		this.SessionId = null;

		this.ApproximateMembers = 0;

		this.FailedConnectionAttempts = 0; // We allow for 15 failed connection attempts before we stop trying to connect

		this.Events = new Events(this);

		this.Resolved = false;
	}

	public async Connect(): Promise<void> {
		return new Promise<void>((resolve) => {
			this.Ws = new WebSocket(
				`${Config.Ws.Url}?v=${Config.Ws.version ?? 0}&p=${encodeURIComponent(Config.Ws.Password)}&c=true&encoding=json`,
				{},
			);

			// @ts-expect-error -- It does exist, though bun doing the funky with the internal ws module
			this.Ws.on("error", () => {
				this.App.Logger.error("Failed to connect to System Socket / Recieved an Error");

				this.HandleDisconnect();

				resolve();

				if (!this.Resolved) {
					this.Resolved = true;
					resolve();
				}
			});

			// @ts-expect-error -- It does exist, though bun doing the funky with the internal ws module
			this.Ws.on("open", () => {
				this.App.Logger.info("Connected to System Socket");
			});

			// @ts-expect-error -- It does exist, though bun doing the funky with the internal ws module
			this.Ws.on("close", (code: number, reason: string) => {
				this.App.Logger.warn("Disconnected from System Socket", reason?.toString(), code);

				this.HandleDisconnect();

				if (!this.Resolved) {
					this.Resolved = true;
					resolve();
				}
			});

			// @ts-expect-error -- It does exist, though bun doing the funky with the internal ws module
			this.Ws.on("message", (data: Buffer) => {
				const Decoded = this.decode(data);

				if (Decoded?.S) this.Sequence = Decoded.S;

				if (Decoded?.Authed === true) {
					this.App.Logger.info("Authed to System Socket");

					this.FailedConnectionAttempts = 0; // Reset the failed connection attempts (Since we are now connected)

					const AuthPayload = Decoded as AuthedPayload;

					this.SessionId = AuthPayload.Misc.SessionId;

					this.ApproximateMembers = AuthPayload.ApproximateMembers;

					if (typeof AuthPayload.Misc.HeartbeatInterval === "number") {
						this.App.Logger.debug("Starting Heartbeat Interval");
						this.HeartbeatInterval = setInterval(() => {
							this.App.Logger.debug("Sending Heartbeat");
							this.Ws?.send(
								JSON.stringify({
									Op: OpCodes.HeartBeat,
									D: {
										Sequence: this.Sequence,
									},
								}),
							);
							this.LastHeartbeat = Date.now();

							this.App.Logger.debug("Heartbeat Sent");
						}, AuthPayload.Misc.HeartbeatInterval - 2_000);
					}

					if (!this.Resolved) {
						this.Resolved = true;
						resolve();
					}
				}

				if (Decoded?.Op) {
					const NormalPayload = Decoded as NormalPayload;

					this.App.Logger.debug(`Received Payload: ${JSON.stringify(NormalPayload)}`);

					switch (NormalPayload.Op) {
						case OpCodes.HeartBeatAck:
							this.LastHeartbeatAck = Date.now();
							this.App.Logger.debug("Heartbeat Acknowledged");
							break;

						case Object.values(SystemOpCodes).find((op) => op === NormalPayload.Op):
							this.App.Logger.debug(
								`Received Event: ${Object.keys(SystemOpCodes).find(
									(op) => SystemOpCodes[op as keyof typeof SystemOpCodes] === NormalPayload.Op,
								)}`,
							);
							break;
					}
				}
			});
		});
	}

	private decode(data: Buffer): any {
		try {
			// eslint-disable-next-line n/no-sync
			const ZlibDecoded = zlib.unzipSync(data);

			return JSON.parse(ZlibDecoded.toString());
		} catch {
			try {
				return JSON.parse(data.toString());
			} catch {
				return null;
			}
		}
	}

	public HandleDisconnect(Force: boolean = false): void {
		if (Force && this.Ws) return;

		if (this.HeartbeatInterval) {
			clearInterval(this.HeartbeatInterval);
			this.HeartbeatInterval = null;
		}

		// @ts-expect-error -- It does exist, though bun doing the funky with the internal ws module
		this.Ws?.removeAllListeners();

		if (!Force && this.FailedConnectionAttempts >= 15) {
			this.App.Logger.error("Failed to connect to System Socket 15 times, stopping attempts");
			return;
		}

		this.FailedConnectionAttempts++;
		this.Ws = null;

		this.App.Logger.debug(`Attempting to reconnect to System Socket, attempt ${this.FailedConnectionAttempts}`);

		setTimeout(async () => {
			await this.Connect();
		}, 5_000);
	}
}

export default SystemSocket;

export { SystemSocket };
