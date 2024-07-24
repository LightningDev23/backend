import { relationshipFlags } from "@/Constants.ts";
import type { UserMiddlewareType } from "@/Middleware/User.ts";
import userMiddleware from "@/Middleware/User.ts";
import type { Infer } from "@/Types/BodyValidation.ts";
import { enums, string } from "@/Types/BodyValidation.ts";
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

const patchRelationshipBody = {
	nickname: string().optional().nullable(),
	flags: enums([
		relationshipFlags.Blocked,
		relationshipFlags.FriendRequest,
		relationshipFlags.Friend,
		relationshipFlags.None,
		relationshipFlags.Ignored,
	]).optional(),
};

export default class RelationshipUser extends Route {
	public constructor(App: API) {
		super(App);
	}

	@Method("patch")
	@Description("modify the relationship")
	@ContentTypes("application/json")
	@Middleware(
		userMiddleware({
			AccessType: "LoggedIn",
			AllowedRequesters: ["User"],
		}),
	)
	public async postRelationships({
		user,
		body,
		params,
		set,
	}: CreateRoute<"/relationships/:relationshipId", Infer<typeof patchRelationshipBody>, [UserMiddlewareType]>) {
		const foundRelationship = await this.App.cassandra.models.Friend.get({
			friendId: Encryption.encrypt(params.relationshipId),
		});

		if (
			!foundRelationship ||
			(foundRelationship.primaryUserId !== Encryption.encrypt(user.id) &&
				foundRelationship.secondaryUserId !== Encryption.encrypt(user.id))
		) {
			const notFound = errorGen.NotFound();

			notFound.addError({
				relationshipId: {
					code: "NotFound",
					message: "The provided relationship does not exist or you have been blocked.",
				},
			});

			set.status = 404;

			return notFound.toJSON();
		}

		const decrpytedFriendship = Encryption.completeDecryption(foundRelationship);

		// ? true = primary user, false = secondary user
		const whoAreWe = BigInt(user.id) <= BigInt(decrpytedFriendship.primaryUserId);

		const relationshipFlagFields = new FlagUtils(
			whoAreWe ? foundRelationship.secondaryUserFlags : foundRelationship.primaryUserFlags,
			relationshipFlags,
		);
		const bodyRelationshipFlag = new FlagUtils(body.flags ?? 0, relationshipFlags);

		if (
			relationshipFlagFields.has("Blocked") &&
			!(bodyRelationshipFlag.has("Blocked") || bodyRelationshipFlag.has("None"))
		) {
			const notFound = errorGen.NotFound();

			notFound.addError({
				relationshipId: {
					code: "NotFound",
					message: "The provided relationship does not exist or you have been blocked.",
				},
			});

			set.status = 404;

			return notFound.toJSON();
		}

		const invalidFlags = errorGen.InvalidField();

		invalidFlags.addError({
			flags: {
				code: "InvalidFlags",
				message: "The flags provided are invalid.",
			},
		});

		// ? if there's more then one error out since you can only set one
		if (bodyRelationshipFlag.count > 1) {
			set.status = 400;

			return invalidFlags.toJSON();
		}

		if (bodyRelationshipFlag.count === 1) {
			// ? If we've currently sent a fq, we cannot set them to friend
			// ? If they have a friend request sent out, we cannot set it to fq (in those cases just accept their request)
			// ? If we set them to a friend, set both flags to friend, if we set it to none set both flags to none (as its a deny)
			// ? If we set them to blocked, we set theirs to none (since it "denys" as well)
			// ? If we are blocked we can only set it to none or blocked as well

			switch (bodyRelationshipFlag.bits) {
				case relationshipFlags.FriendRequest:
				case relationshipFlags.Friend: {
					// ? First we got to confirm they have a friend request sent out for the friend one
					if (bodyRelationshipFlag.has("Friend") && !relationshipFlagFields.has("FriendRequest")) {
						set.status = 400;

						return invalidFlags.toJSON();
					}

					// ? If we are blocked we can only set it to none or blocked as well
					if (relationshipFlagFields.has("Blocked")) {
						set.status = 400;

						return invalidFlags.toJSON();
					}

					// ? If we've currently sent a fq, we cannot set them to friend
					const ourFlags = new FlagUtils(
						whoAreWe ? foundRelationship.primaryUserFlags : foundRelationship.secondaryUserFlags,
						relationshipFlags,
					);

					if (ourFlags.has("FriendRequest") && bodyRelationshipFlag.has("Friend")) {
						set.status = 400;

						return invalidFlags.toJSON();
					}

					// ? If they have a friend request sent out, and we send a fq as well, we go ahead and accept their request
					// ? This is also where we do the logic for setting them to friend if they got a fq sent out
					if (
						(relationshipFlagFields.has("FriendRequest") && bodyRelationshipFlag.has("FriendRequest")) ||
						(relationshipFlagFields.has("FriendRequest") && bodyRelationshipFlag.has("Friend"))
					) {
						const newFlags = {
							primaryUserFlags: relationshipFlags.Friend,
							secondaryUserFlags: relationshipFlags.Friend,
						};

						await this.App.cassandra.models.Friend.update({
							friendId: Encryption.encrypt(params.relationshipId),
							primaryUserId: foundRelationship.primaryUserId,
							secondaryUserId: foundRelationship.secondaryUserId,
							...newFlags,
						});

						set.status = 204;

						return;
					}

					// ? If we both have none, send a friend request
					if (relationshipFlagFields.has("None") && bodyRelationshipFlag.has("FriendRequest")) {
						const newFlags = {
							primaryUserFlags: relationshipFlags.FriendRequest,
							secondaryUserFlags: relationshipFlags.None,
						};

						await this.App.cassandra.models.Friend.update({
							friendId: Encryption.encrypt(params.relationshipId),
							primaryUserId: foundRelationship.primaryUserId,
							secondaryUserId: foundRelationship.secondaryUserId,
							...newFlags,
						});

						set.status = 204;

						return;
					}

					// ? this should NOT happen, just return internal server error if it does

					set.status = 500;

					return "Internal Server Error :(";
				}

				case relationshipFlags.Blocked: {
					// ? If we are blocked we can only set it to none or blocked as well
					if (
						relationshipFlagFields.has("Blocked") &&
						(!bodyRelationshipFlag.has("Blocked") || !bodyRelationshipFlag.has("None"))
					) {
						set.status = 400;

						return invalidFlags.toJSON();
					}

					// ? If we are setting them to blocked, and they are currently friends, set their flags to none since we are no longer friends
					const newFlags = {
						primaryUserFlags: whoAreWe
							? relationshipFlags.Blocked
							: relationshipFlagFields.has("Friend")
								? relationshipFlags.None
								: relationshipFlagFields.bits,
						secondaryUserFlags: whoAreWe
							? relationshipFlagFields.has("Friend")
								? relationshipFlags.None
								: relationshipFlagFields.bits
							: relationshipFlags.Blocked,
					};

					await this.App.cassandra.models.Friend.update({
						friendId: Encryption.encrypt(params.relationshipId),
						primaryUserId: foundRelationship.primaryUserId,
						secondaryUserId: foundRelationship.secondaryUserId,
						...newFlags,
					});

					set.status = 204;

					return;
				}

				case relationshipFlags.None: {
					// ? If we are blocked we can only set it to none or blocked as well
					if (
						relationshipFlagFields.has("Blocked") &&
						(!bodyRelationshipFlag.has("Blocked") || !bodyRelationshipFlag.has("None"))
					) {
						set.status = 400;

						return invalidFlags.toJSON();
					}

					// ? If we are setting them to none, and they are currently friends, set their flags to none since we are no longer friends
					const newFlags = {
						primaryUserFlags: whoAreWe
							? relationshipFlags.None
							: relationshipFlagFields.has("Friend")
								? relationshipFlags.None
								: relationshipFlagFields.bits,
						secondaryUserFlags: whoAreWe
							? relationshipFlagFields.has("Friend")
								? relationshipFlags.None
								: relationshipFlagFields.bits
							: relationshipFlags.None,
					};

					await this.App.cassandra.models.Friend.update({
						friendId: Encryption.encrypt(params.relationshipId),
						primaryUserId: foundRelationship.primaryUserId,
						secondaryUserId: foundRelationship.secondaryUserId,
						...newFlags,
					});

					set.status = 204;

					return;
				}

				case relationshipFlags.Ignored: {
					// ? if we are ignoring them and they do not have a fq sent out we error out as we cannot ignore them

					if (!relationshipFlagFields.has("FriendRequest")) {
						set.status = 400;

						return invalidFlags.toJSON();
					}

					// ? Now we just set the flags to ignored (they keep their fq)
					const newFlags = {
						primaryUserFlags: whoAreWe ? relationshipFlags.Ignored : relationshipFlagFields.bits,
						secondaryUserFlags: whoAreWe ? relationshipFlagFields.bits : relationshipFlags.Ignored,
					};

					await this.App.cassandra.models.Friend.update({
						friendId: Encryption.encrypt(params.relationshipId),
						primaryUserId: foundRelationship.primaryUserId,
						secondaryUserId: foundRelationship.secondaryUserId,
						...newFlags,
					});

					set.status = 204;

					return;
				}

				default: {
					set.status = 400;

					return invalidFlags.toJSON();
				}
			}
		}

		if (body.nickname) {
			if (!relationshipFlagFields.has("Friend")) {
				const notFound = errorGen.NotFound();

				notFound.addError({
					relationshipId: {
						code: "NotFound",
						message: "The provided relationship does not exist or you have been blocked or you are not friends.",
					},
				});

				set.status = 404;

				return notFound.toJSON();
			}

			const newNickname = whoAreWe
				? {
						primaryUserNickname: body.nickname,
					}
				: {
						secondaryUserNickname: body.nickname,
					};

			await this.App.cassandra.models.Friend.update({
				friendId: Encryption.encrypt(params.relationshipId),
				primaryUserId: foundRelationship.primaryUserId,
				secondaryUserId: foundRelationship.secondaryUserId,
				...newNickname,
			});

			set.status = 204;
		}
	}
}
