import GuildMemberFlags from "@/Utils/Classes/BitFields/GuildMember.ts";
import type { PermissionKey } from "@/Utils/Classes/BitFields/Permissions.ts";
import Permissions from "@/Utils/Classes/BitFields/Permissions.ts";
import Encryption from "@/Utils/Classes/Encryption.ts";

class PermissionHandler {
	public guildMemberFlags: GuildMemberFlags;

	public memberRoles: {
		id: string;
		permissions: Permissions;
		position: number;
	}[];

	public channels: {
		id: string;
		overrides: {
			allow: Permissions;
			deny: Permissions;
			// Role / Member Id
			id: string;
			type: "Member" | "Role";
		}[];
	}[];

	public guildMemberId: string;

	public constructor(
		guildMemberId: string,
		guildMemberFlags: bigint | number | string,
		memberRoles: { id: string; permissions: [bigint | string, bigint | string][]; position: number }[],
		channels?: {
			id: string;
			overrides: {
				allow: [bigint | string, bigint | string][];
				deny: [bigint | string, bigint | string][];
				id: string;
				type: "Member" | "Role";
			}[];
		}[],
	) {
		this.guildMemberId = Encryption.decrypt(guildMemberId);

		this.guildMemberFlags = new GuildMemberFlags(guildMemberFlags);

		this.memberRoles = memberRoles.map((Role) => ({
			id: Encryption.decrypt(Role.id),
			permissions: new Permissions(Role.permissions),
			position: Role.position,
		}));

		this.channels =
			channels?.map((Channel) => ({
				id: Encryption.decrypt(Channel.id),
				overrides: Channel.overrides.map((Override) => ({
					allow: new Permissions(Override.allow),
					deny: new Permissions(Override.deny),
					id: Encryption.decrypt(Override.id),
					type: Override.type,
				})),
			})) ?? [];
	}

	/**
	 *? Checks if you have permission on any role, also takes in account position (i.e if you have a role with the permission, but a role above that role denies it, then you don't have the permission)
	 */
	public hasAnyRole(permission: PermissionKey[], dupe?: boolean, all?: boolean): boolean {
		// ? If you are the owner or co-owner, you have all permissions
		if (this.guildMemberFlags.has("Owner") || this.guildMemberFlags.has("CoOwner")) {
			return true;
		}

		const roles = this.memberRoles
			.filter((Role) => Role.permissions.has(permission, undefined, all ? "all" : "some"))
			.sort((a, b) => b.position - a.position);

		if (dupe) {
			return roles.length > 0;
		}

		return roles.length > 0 && roles[0]!.permissions.has(permission, undefined, all ? "all" : "some");
	}

	/**
	 *? If you are able to manage a specific role (mainly checks the position of the role)
	 */
	public canManageRole(role: {
		id: string;
		permissions: [bigint | string, bigint | string][];
		position: number;
	}): boolean {
		if (this.guildMemberFlags.has("Owner") || this.guildMemberFlags.has("CoOwner")) {
			return true;
		}

		const membersHighestRole = this.memberRoles.sort((a, b) => b.position - a.position)[0];

		if (!membersHighestRole) {
			return false;
		}

		return membersHighestRole.position > role.position;
	}

	/**
	 *? Checks if you have permission to a specific channel
	 */
	public hasChannelPermission(channelId: string, permission: PermissionKey[], all?: boolean): boolean {
		const channel = this.channels.find((Channel) => Channel.id === channelId);

		if (!channel) {
			return false;
		}

		if (this.guildMemberFlags.has("Owner") || this.guildMemberFlags.has("CoOwner")) {
			return true;
		}

		const overrides = channel.overrides.filter(
			(Override) => Override.id === this.guildMemberId || this.memberRoles.some((Role) => Role.id === Override.id),
		);

		if (overrides.length === 0) {
			return this.hasAnyRole(permission, undefined, all);
		}

		const allow = all
			? overrides.every((Override) => Override.allow.has(permission))
			: overrides.some((Override) => Override.allow.has(permission));

		const deny = all
			? overrides.every((Override) => Override.deny.has(permission))
			: overrides.some((Override) => Override.deny.has(permission));

		return allow && !deny;
	}
}

export default PermissionHandler;
