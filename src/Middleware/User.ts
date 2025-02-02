import type { UserMiddleware } from "@/Types/Routes.ts";
import FlagFields from "@/Utils/Classes/BitFields/Flags.ts";
import Encryption from "@/Utils/Classes/Encryption.ts";
import errorGen from "@/Utils/Classes/ErrorGen.ts";
import type { CreateMiddleware, CreateRoute } from "@/Utils/Classes/Routing/Route.ts";
import Token from "@/Utils/Classes/Token.ts";
import { settingsTable } from "@/Utils/Cql/Tables/SettingsTable.ts";
import { usersTable } from "@/Utils/Cql/Tables/UserTable.ts";

export interface UserMiddlewareType extends Record<string, any> {
	user: {
		bot: boolean;
		email: string;
		flagsUtil: FlagFields;
		guilds: string[];
		id: string;
		password: string;
		settings: {
			allowedInvites: number;
			bio: string | null;
			customStatus: string | null;
			emojiPack: "fluentui-emoji" | "native" | "noto-emoji" | "twemoji";
			guildOrder: {
				guildId: string;
				position: number;
			}[];
			language: string;
			navBarLocation: "bottom" | "left";
			privacy: number;
			status: "dnd" | "idle" | "invisible" | "offline" | "online";
			theme: string;
		};
		token: string;
		username: string;
	};
}

const userMiddleware = (options: UserMiddleware) => {
	return async ({
		headers,
		set,
		app,
	}: CreateRoute<string, {}>): Promise<CreateMiddleware<Record<string, unknown> | UserMiddlewareType | string>> => {
		let authHeader = headers.authorization;
		const isBot = headers.authorization?.toLowerCase()?.startsWith("bot ") ?? false;

		const unAuthorizedError = errorGen.UnAuthorized();

		if ((isBot && options.AllowedRequesters === "User") || (!isBot && options.AllowedRequesters === "Bot")) {
			app.logger.debug(`Unexpected User Type ${isBot ? "Is Bot" : "Isn't Bot"}`);

			unAuthorizedError.addError({
				user: {
					code: "InvalidUserType",
					message: "You are not allowed to access this endpoint.",
				},
			});

			set.status = 401;

			return unAuthorizedError.toJSON();
		}

		authHeader = authHeader?.split(" ").length === 2 ? authHeader.split(" ")[1] : authHeader;

		if (options.AccessType === "LoggedIn" && !authHeader) {
			app.logger.debug("User isn't logged in though it is expected");

			unAuthorizedError.addError({
				user: {
					code: "NotLoggedIn",
					message: "You need to be logged in to access this endpoint",
				},
			});

			set.status = 401;

			return unAuthorizedError.toJSON();
		}

		if (options.AccessType === "LoggedOut" && authHeader) {
			app.logger.debug("User is logged in though its not expected");

			unAuthorizedError.addError({
				user: {
					code: "LoggedIn",
					message: "You are not allowed to access this endpoint.",
				},
			});

			set.status = 401;

			return unAuthorizedError.toJSON();
		}

		if (options.AccessType === "LoggedIn" && authHeader) {
			const vaildatedToken = Token.validateToken(authHeader);

			if (!vaildatedToken) {
				app.logger.debug("Token couldn't be validated");

				unAuthorizedError.addError({
					user: {
						code: "InvalidToken",
						message: "The token provided was invalid",
					},
				});

				set.status = 401;

				return unAuthorizedError.toJSON();
			}

			const decodedToken = Token.decodeToken(authHeader);

			const userSettings = await settingsTable.get(
				{
					userId: Encryption.encrypt(decodedToken.Snowflake),
				},
				{
					fields: [
						"tokens",
						"maxFileUploadSize",
						"bio",
						"guildOrder",
						"language",
						"privacy",
						"theme",
						"status",
						"allowedInvites",
						"customStatus",
						"navLocation",
						"emojiPack",
					],
				},
			);

			const userData = await usersTable.get(
				{
					userId: Encryption.encrypt(decodedToken.Snowflake),
				},
				{
					fields: ["email", "userId", "flags", "password", "publicFlags", "guilds", "username"],
				},
			);

			if (!userSettings || !userData) {
				app.logger.debug("User settings wasn't found", decodedToken.Snowflake);
				app.logger.debug(userData ?? "null", userSettings ?? "null");

				unAuthorizedError.addError({
					user: {
						code: "InvalidToken",
						message: "The token provided was invalid",
					},
				});

				if ((userData && !userSettings) || (!userData && userSettings)) {
					// darkerink: just in case there is one but not the other (has happened in very rare cases) contacting support will be the only way to fix this (for now);
					set.status = 500;

					return "Internal Server Error :(";
				} else {
					set.status = 401;

					return unAuthorizedError.toJSON();
				}
			}

			if (!userSettings?.tokens?.some((Token) => Token.token === Encryption.encrypt(authHeader as string))) {
				app.logger.debug("Token not found in the user settings");

				unAuthorizedError.addError({
					user: {
						code: "InvalidToken",
						message: "The token provided was invalid",
					},
				});

				set.status = 401;

				return unAuthorizedError.toJSON();
			}

			const userFlags = new FlagFields(userData.flags ?? "0", userData.publicFlags ?? "0");
			const accountNotAvailableError = errorGen.AccountNotAvailable();

			if (
				userFlags.PrivateFlags.has("AccountDeleted") ||
				userFlags.PrivateFlags.has("WaitingOnDisableDataUpdate") ||
				userFlags.PrivateFlags.has("WaitingOnAccountDeletion")
			) {
				app.logger.debug("Account Is Deleted or about to be deleted");

				accountNotAvailableError.addError({
					email: {
						code: "AccountDeleted",
						message: "The Account has been deleted",
					},
				});

				set.status = 401;

				return accountNotAvailableError.toJSON();
			}

			if (userFlags.PrivateFlags.has("Terminated") || userFlags.PrivateFlags.has("Disabled")) {
				app.logger.debug("Account Is Disabled or Terminated");

				accountNotAvailableError.addError({
					email: {
						code: "AccountDisabled",
						message: "The Account has been disabled",
					},
				});

				set.status = 401;

				return accountNotAvailableError.toJSON();
			}

			if (
				(isBot && (!userFlags.PrivateFlags.has("Bot") || !userFlags.PrivateFlags.has("VerifiedBot"))) ||
				(!isBot && (userFlags.PrivateFlags.has("Bot") || userFlags.PrivateFlags.has("VerifiedBot")))
			) {
				app.logger.debug(
					"The user has a (or is missing) a flag its not meant to (bot) and is using an invalid header tbh idk how to log this well",
					isBot,
					(!isBot && userFlags.PrivateFlags.has("Bot")) || userFlags.PrivateFlags.has("VerifiedBot"),
					(isBot && !userFlags.PrivateFlags.has("Bot")) || !userFlags.PrivateFlags.has("VerifiedBot"),
				);

				unAuthorizedError.addError({
					user: {
						code: "InvalidUserType",
						message: "You are not allowed to access this endpoint.",
					},
				});

				set.status = 401;

				return unAuthorizedError.toJSON();
			}

			if (
				options.AllowedRequesters.includes("User") &&
				(userFlags.PrivateFlags.has("Bot") || userFlags.PrivateFlags.has("VerifiedBot"))
			) {
				app.logger.debug("User only endpoint though user is a bot");

				unAuthorizedError.addError({
					user: {
						code: "InvalidToken",
						message: "You are not allowed to access this endpoint.",
					},
				});

				set.status = 401;

				return unAuthorizedError.toJSON();
			}

			if (
				options.AllowedRequesters.includes("Bot") &&
				!(userFlags.PrivateFlags.has("Bot") || userFlags.PrivateFlags.has("VerifiedBot"))
			) {
				app.logger.debug("Bot only endpoint though user is not a bot");

				unAuthorizedError.addError({
					user: {
						code: "InvalidToken",
						message: "You are not allowed to access this endpoint.",
					},
				});

				set.status = 401;

				return unAuthorizedError.toJSON();
			}

			if (options.Flags && options.Flags.length > 0) {
				for (const flag of options.Flags) {
					if (!userFlags.PrivateFlags.has(flag)) {
						app.logger.debug(`User is missing the ${flag} flag`);

						unAuthorizedError.addError({
							user: {
								code: "LostInTheMaze",
								message: "You seemed to have gotten lost in the maze.. Are you sure it was meant for you?",
							},
						});

						set.status = 401;

						return unAuthorizedError.toJSON();
					}
				}
			}

			if (options.DisallowedFlags && options.DisallowedFlags.length > 0) {
				for (const flag of options.DisallowedFlags) {
					if (userFlags.PrivateFlags.has(flag)) {
						app.logger.debug(`User has the ${flag} flag`);

						unAuthorizedError.addError({
							user: {
								code: "LostInTheMaze",
								message: "You seemed to have gotten lost in the maze.. Are you sure it was meant for you?", // yes this is a joke for Discord's staff only endpoints
							},
						});

						set.status = 401;

						return unAuthorizedError.toJSON();
					}
				}
			}

			const completeDecrypted = Encryption.completeDecryption({
				...userData,
				flags: (userData.flags ?? "").toString(),
				publicFlags: (userData.publicFlags ?? "").toString(),
			});

			return {
				user: {
					token: authHeader,
					bot: userFlags.PrivateFlags.has("Bot") || userFlags.PrivateFlags.has("VerifiedBot"),
					flagsUtil: userFlags,
					email: completeDecrypted.email,
					id: completeDecrypted.userId,
					password: completeDecrypted.password,
					guilds: completeDecrypted.guilds ?? [],
					username: completeDecrypted.username,
					settings: Encryption.completeDecryption({
						bio: userSettings.bio,
						guildOrder: userSettings.guildOrder ?? [],
						language: userSettings.language,
						privacy: userSettings.privacy,
						status: userSettings.status,
						theme: userSettings.theme,
						allowedInvites: userSettings.allowedInvites ?? 0,
						customStatus: userSettings.customStatus,
						navBarLocation: userSettings.navLocation ?? "bottom",
						emojiPack: userSettings.emojiPack ?? "twemoji",
					}),
				},
			};
		}

		return "";
	};
};

export default userMiddleware;
