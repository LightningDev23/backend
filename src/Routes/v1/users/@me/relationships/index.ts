import { relationshipFlags } from "@/Constants.ts";
import bodyValidator from "@/Middleware/BodyValidator.ts";
import type { UserMiddlewareType } from "@/Middleware/User.ts";
import userMiddleware from "@/Middleware/User.ts";
import type { Infer } from "@/Types/BodyValidation.ts";
import { enums, snowflake, string } from "@/Types/BodyValidation.ts";
import type API from "@/Utils/Classes/API.ts";
import { FlagUtils } from "@/Utils/Classes/BitFields/NewFlags.ts";
import Encryption from "@/Utils/Classes/Encryption.ts";
import errorGen from "@/Utils/Classes/ErrorGen.ts";
import ContentTypes from "@/Utils/Classes/Routing/Decorators/ContentTypes.ts";
import Description from "@/Utils/Classes/Routing/Decorators/Description.ts";
import Method from "@/Utils/Classes/Routing/Decorators/Method.ts";
import Middleware from "@/Utils/Classes/Routing/Decorators/Middleware.ts";
import type { CreateRoute } from "@/Utils/Classes/Routing/Route.ts";
import Route from "@/Utils/Classes/Routing/Route.ts";
import type { Friend } from "@/Utils/Cql/Types/index.ts";

const postRelationshipBody = {
	userId: snowflake().optional(),
	username: string().optional(),
	flags: enums([relationshipFlags.Blocked, relationshipFlags.FriendRequest]),
};

export default class Relationships extends Route {
	public constructor(App: API) {
		super(App);
	}

	@Method("get")
	@Description("Get your relationships")
	@ContentTypes("any")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: ["User"],
		}),
	)
	public async getRelationships({
		user,
		query,
	}: CreateRoute<
		"/relationships",
		any,
		[UserMiddlewareType],
		any,
		{
			includeUser: "false" | "true";
		}
	>) {
		const parsedRelationships: {
			createdAt: string;
			nickname: string | null;
			pending: boolean;
			relationshipFlags: number;
			relationshipId: string;
			user?:
				| never
				| {
						avatar: string | null;
						flags: string;
						globalNickname: string | null;
						id: string;
						publicFlags: string;
						tag: string;
						username: string;
				  };
			userId?: never | string;
		}[] = [];

		const relationships = [
			(
				await this.App.cassandra.models.Friend.find({
					primaryUserId: Encryption.encrypt(user.id),
				})
			).toArray(),
			(
				await this.App.cassandra.models.Friend.find({
					secondaryUserId: Encryption.encrypt(user.id),
				})
			).toArray(),
		].flat();

		for (const relationship of relationships) {
			const decrypted = Encryption.completeDecryption(relationship);

			const whoAreWe = user.id !== decrypted.primaryUserId;

			const userId = whoAreWe ? decrypted.primaryUserId : decrypted.secondaryUserId;

			if (query.includeUser !== "true") {
				parsedRelationships.push({
					relationshipId: decrypted.friendId,
					relationshipFlags: whoAreWe ? decrypted.secondaryUserFlags : decrypted.primaryUserFlags,
					// ? Possibly a security concern(?) since it may leak when the other user blocked you
					createdAt: decrypted.createdAt.toISOString(),
					userId,
					nickname: whoAreWe ? decrypted.primaryUserNickname : decrypted.secondaryUserNickname,
					pending: whoAreWe
						? decrypted.primaryUserFlags === relationshipFlags.FriendRequest
						: decrypted.secondaryUserFlags === relationshipFlags.FriendRequest,
				});

				continue;
			}

			const fetchedUser = (await this.App.cassandra.models.User.get(
				{
					userId: Encryption.encrypt(userId),
				},
				{
					fields: ["avatar", "flags", "globalNickname", "publicFlags", "tag", "username"],
				},
			))!; // ? it should always exist since we are fetching it from a relationship

			parsedRelationships.push({
				relationshipId: decrypted.friendId,
				relationshipFlags: whoAreWe ? decrypted.secondaryUserFlags : decrypted.primaryUserFlags,
				createdAt: decrypted.createdAt.toISOString(),
				nickname: whoAreWe ? decrypted.primaryUserNickname : decrypted.secondaryUserNickname,
				pending: whoAreWe
					? decrypted.primaryUserFlags === relationshipFlags.FriendRequest
					: decrypted.secondaryUserFlags === relationshipFlags.FriendRequest,
				user: {
					avatar: fetchedUser.avatar,
					flags: fetchedUser.flags,
					globalNickname: fetchedUser.globalNickname,
					publicFlags: fetchedUser.publicFlags,
					tag: fetchedUser.tag,
					username: fetchedUser.username,
					id: userId,
				},
			});
		}

		// ? We remove any marked as none or ignored and is not pending since that means we have no relationship with them
		return Encryption.completeDecryption(
			parsedRelationships.filter((x) => x.relationshipFlags !== relationshipFlags.None || x.relationshipFlags !== relationshipFlags.Ignored || x.pending),
		);
	}

	@Method("post")
	@Description("Create a new relationship")
	@ContentTypes("application/json")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: ["User"],
		}),
	)
	@Middleware(bodyValidator(postRelationshipBody))
	public async postRelationships({
		user,
		body,
		set,
	}: CreateRoute<"/relationships", Infer<typeof postRelationshipBody>, [UserMiddlewareType]>) {
		if (user.id === body.userId) {
			const invalidUser = errorGen.InvalidUser();

			invalidUser.addError({
				user: {
					code: "InvalidUser",
					message: "You cannot create a relationship with yourself.",
				},
			});

			set.status = 400;

			return invalidUser.toJSON();
		}

		const fetchedUser = body.userId
			? await this.App.cassandra.models.User.get({
					userId: Encryption.encrypt(body.userId),
				})
			: body.username
				? await this.App.cassandra.models.User.get({
						username: Encryption.encrypt(body.username.split("#")[0] ?? ""),
						tag: Encryption.encrypt(body.username.split("#")[1] ?? ""),
					})
				: null;

		if (!fetchedUser) {
			const userNotFound = errorGen.InvalidUser();

			userNotFound.addError({
				user: {
					code: "InvalidUser",
					message: "The requested user does not exist, or they have blocked you.",
				},
			});

			set.status = 404;

			return userNotFound.toJSON();
		}

		const decryptedUserId = Encryption.decrypt(fetchedUser.userId);

		const whoAreWe = BigInt(user.id) <= BigInt(decryptedUserId);

		// ? we check if the relationship already exists since we do not want to create a duplicate relationship

		const foundRelationship = await this.App.cassandra.models.Friend.get({
			// ? Primary user id is always the oldest user id (we can just bigint compare)
			primaryUserId: whoAreWe ? Encryption.encrypt(user.id) : Encryption.encrypt(decryptedUserId),
			// ? then obv secondary user id is the other user
			secondaryUserId: whoAreWe ? Encryption.encrypt(decryptedUserId) : Encryption.encrypt(user.id),
		});

		const flags = new FlagUtils(body.flags, relationshipFlags);

		if (foundRelationship) {
			// ? Make sure we aren't blocked, if we are we return a similar error to the user not existing
			const relationshipFlagFields = new FlagUtils(
				whoAreWe ? foundRelationship.secondaryUserFlags : foundRelationship.primaryUserFlags,
				relationshipFlags,
			);

			if (relationshipFlagFields.has("Blocked") && flags.has("FriendRequest")) {
				const userNotFound = errorGen.InvalidUser();

				userNotFound.addError({
					user: {
						code: "InvalidUser",
						message: "The requested user does not exist, or they have blocked you.",
					},
				});

				set.status = 404;

				return userNotFound.toJSON();
			}

			// ? If we are already friends then we return an error
			if (relationshipFlagFields.has("Friend")) {
				const alreadyFriends = errorGen.RelationshipAlreadyExists();

				alreadyFriends.addError({
					relationship: {
						code: "RelationshipAlreadyExists",
						message: "The relationship already exists.",
					},
				});

				set.status = 400;

				return alreadyFriends.toJSON();
			}

			// ? If are flags are not 0, then we have to edit the relationship we cannot just create a new one
			const ourFlags = whoAreWe ? foundRelationship.primaryUserFlags : foundRelationship.secondaryUserFlags;

			if (ourFlags !== relationshipFlags.None) {
				const relationshipAlreadyExists = errorGen.RelationshipAlreadyExists();

				relationshipAlreadyExists.addError({
					relationship: {
						code: "RelationshipAlreadyExists",
						message: "The relationship already exists.",
					},
				});

				set.status = 400;

				return relationshipAlreadyExists.toJSON();
			}

			if (!flags.has("Blocked") || (flags.has("Blocked") && flags.has("FriendRequest"))) {
				const invalidFlags = errorGen.InvalidField();

				invalidFlags.addError({
					flags: {
						code: "InvalidFlags",
						message: "The flags provided are invalid.",
					},
				});

				set.status = 400;

				return invalidFlags.toJSON();
			}

			const data: Partial<Friend> = {
				primaryUserFlags: whoAreWe ? flags.bits : foundRelationship.primaryUserFlags,
				secondaryUserFlags: whoAreWe ? foundRelationship.secondaryUserFlags : flags.bits,
				primaryUserId: whoAreWe ? Encryption.encrypt(user.id) : Encryption.encrypt(decryptedUserId),
				secondaryUserId: whoAreWe ? Encryption.encrypt(decryptedUserId) : Encryption.encrypt(user.id),
				friendId: foundRelationship.friendId,
			};

			await this.App.cassandra.models.Friend.update(data);

			this.App.rabbitMQForwarder("relationships.update", {
				userId: Encryption.decrypt(user.id),
				relationshipId: Encryption.decrypt(foundRelationship.friendId),
				relationshipFlags: flags.bits,
				targetUserId: Encryption.decrypt(decryptedUserId),
			});

			return {
				relationshipId: Encryption.decrypt(foundRelationship.friendId),
				relationshipFlags: flags.bits,
				userId: Encryption.decrypt(decryptedUserId),
			};
		}

		// ? it cannot be both blocked and a friend request
		if (flags.has("Blocked") && flags.has("FriendRequest")) {
			const invalidFlags = errorGen.InvalidField();

			invalidFlags.addError({
				flags: {
					code: "InvalidFlags",
					message: "The flags provided are invalid.",
				},
			});

			set.status = 400;

			return invalidFlags.toJSON();
		}

		const data = {
			primaryUserId: whoAreWe ? Encryption.encrypt(user.id) : Encryption.encrypt(decryptedUserId),
			secondaryUserId: whoAreWe ? Encryption.encrypt(decryptedUserId) : Encryption.encrypt(user.id),
			primaryUserFlags: whoAreWe ? flags.bits : relationshipFlags.None,
			secondaryUserFlags: whoAreWe ? relationshipFlags.None : flags.bits,
			createdAt: new Date(),
			friendId: Encryption.encrypt(this.App.snowflake.generate()),
			primaryUserNickname: null,
			secondaryUserNickname: null,
		};

		await this.App.cassandra.models.Friend.insert(data);

		this.App.rabbitMQForwarder("relationships.create", {
			userId: Encryption.decrypt(user.id),
			relationshipId: Encryption.decrypt(data.friendId),
			relationshipFlags: flags.bits,
			createdAt: data.createdAt,
			targetUserId: Encryption.decrypt(decryptedUserId),
		});

		return {
			relationshipId: Encryption.decrypt(data.friendId),
			relationshipFlags: flags.bits,
			createdAt: data.createdAt,
			userId: Encryption.decrypt(decryptedUserId),
		};
	}
}
