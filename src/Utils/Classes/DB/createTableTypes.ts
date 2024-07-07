import type Client from "./Client.ts";
import type Table from "./Table.ts";

export type ColumnTypesRaw =
	| BigIntConstructor
	| BooleanConstructor
	| DateConstructor
	| NumberConstructor
	| StringConstructor;

export type ExtractNameBasedOffConstructor<T extends ColumnTypesRaw> = T extends BigIntConstructor
	? "BigInt"
	: T extends BooleanConstructor
		? "Boolean"
		: T extends DateConstructor
			? "Timestamp"
			: T extends NumberConstructor
				? "Number"
				: T extends StringConstructor
					? "String"
					: never;

export type ColumnTypesStrings =
	| "BigInt"
	| "bigint"
	| "Boolean"
	| "boolean"
	| "Date"
	| "date"
	| "Int"
	| "int"
	| "Number"
	| "number"
	| "String"
	| "string"
	| "Timestamp"
	| "timestamp";

export type ListableTypes = `list<${ColumnTypesStrings | FrozenTypes}>`;

export type ListableTypesNoFrozen = `list<${ColumnTypesStrings}>`;

export type FrozenTypes = `frozen<${ColumnTypesStrings}>`;

export type FrozenlessTypes = ColumnTypesRaw | ColumnTypesStrings | ListableTypesNoFrozen | [FrozenlessTypes];

export type AllTypes = ColumnTypesRaw | ColumnTypesStrings | FrozenTypes | ListableTypes | [AllTypes];

export type ListAndFreezeType<T> = T extends string
	?
			| `frozen<${T}>`
			| `list<${T}>`
			| `list<frozen<${T}>>`
			| [`frozen<${T}>`]
			| [`list<${T}>`]
			| [`list<frozen<${T}>>`]
			| [T]
	: never;

type Decrement<N extends number> = N extends 10
	? 9
	: N extends 9
		? 8
		: N extends 8
			? 7
			: N extends 7
				? 6
				: N extends 6
					? 5
					: N extends 5
						? 4
						: N extends 4
							? 3
							: N extends 3
								? 2
								: N extends 2
									? 1
									: N extends 1
										? 0
										: never;

export type ConvertType<T extends FrozenlessTypes, Depth extends number = 10> = Depth extends never
	? never
	: T extends ColumnTypesRaw
		? `frozen<${Lowercase<ExtractNameBasedOffConstructor<T>>}>`
		: T extends ColumnTypesStrings
			? `frozen<${Lowercase<T>}>`
			: // @ts-expect-error -- Its fine
				T extends ListableTypesNoFrozen
				? `list<${ConvertType<ExtractType<T>, Decrement<Depth>>}>`
				: T extends [FrozenlessTypes]
					? `list<${ConvertType<T[0], Decrement<Depth>>}>`
					: never;

export type ExtractType<T extends string> = T extends `list<${infer U}>` ? U : never;

export type ConvertToActualType<T> = T extends `list<${infer U}>`
	? ConvertToActualType<U>[]
	: T extends `frozen<${infer U}>`
		? ConvertToActualType<U>
		: T extends [infer U]
			? ConvertToActualType<U>[]
			: T extends "BigInt" | "bigint"
				? bigint
				: T extends "Boolean" | "boolean"
					? boolean
					: T extends "Timestamp" | "timestamp"
						? Date
						: T extends "Number" | "number"
							? number
							: T extends "String" | "string"
								? string
								: T extends BigIntConstructor
									? bigint
									: T extends BooleanConstructor
										? boolean
										: T extends DateConstructor
											? Date
											: T extends NumberConstructor
												? number
												: T extends StringConstructor
													? string
													: never;

export type ConvertObjectToNormal<T> = {
	[K in keyof T]: ConvertToActualType<T[K]>;
};

export enum DataTypes {
	BigInt = "bigint",
	Boolean = "boolean",
	Date = "timestamp",
	Number = "int",
	String = "text",

	Text = "text",

	Timestamp = "timestamp",
}

interface CassandraTableOptions {
	bloomFilterFpChance?: number;
	caching?: {
		keys: string;
		rowsPerPartition: string;
	};
	cdc?: boolean;
	// ScyllaDB-specific
	clusteringOrder?: string;
	comment?: string;
	compaction?: {
		[key: string]: unknown;
		class: string;
		sstableSizeInMb?: string; // for additional options specific to the compaction strategy
	};
	compression?: {
		[key: string]: unknown;
		chunkLengthKb?: number;
		sstableCompression: string; // for additional options specific to the compression algorithm
	};
	// ScyllaDB-specific
	concurrentReads?: number;
	// ScyllaDB-specific
	concurrentWrites?: number;
	crcCheckChance?: number;
	dclocalReadRepairChance?: number;
	defaultTimeToLive?: number;
	extensions?: {
		[key: string]: unknown;
	};
	gcGraceSeconds?: number;
	maxIndexInterval?: number;
	memtableFlushPeriodInMs?: number;
	memtableWriteThroughputInMb?: number;
	minIndexInterval?: number;
	readRepairChance?: number;
	speculativeRetry?: string;
	// ScyllaDB-specific
	timeout?: number;
}

export interface Options<
	Types extends Record<string, Record<string, AllTypes | ListAndFreezeType<keyof Types>>>,
	Columns extends Record<string, AllTypes | ListAndFreezeType<keyof Types>>,
	PrimaryKeys extends keyof Columns | [keyof Columns, keyof Columns],
	IndexKeys extends keyof Columns,
> {
	/**
	 * The actual columns of the table
	 */
	columns: Columns;

	/**
	 * Create the table if it does not exist. If it does exist, we will first compare the local vs the remote table
	 * If remote has extra columns vs local, we will ask if you want to delete them (Since this is a destructive operation). Now if there's extra columns in local vs remote, we will add them since its not destructive
	 *
	 * When you want to query data, we will check the version, if the version mismatches we will continuesly run the migration scripts until the version matches in order
	 * (so you can only worry about the previous version, not all versions before it)
	 */
	ifNotExists?: boolean;

	/**
	 * Ignore missing columns, this is for remote, so lets say you got a table that has these columns: a, b, c, d and in a later update you remove b
	 * Instead of asking you to delete it, we will just ignore it. This is only useful when you have a table that is constantly being updated and you need the old columns for old api versions.
	 *
	 * NOTE: since this ""wrapper"" is trying to be type safe, you may need to add @ts-expect-error when you try to query old columns
	 */
	ignoreMissingColumns?: boolean;

	/**
	 * These are the indexes for the table, they normally require a name but if not provided we generate like this: "[table]_inx_[index]"
	 * if you want a custom index name, you can provide a tuple with the first value being the name and the second being the index
	 */
	indexes?: (IndexKeys | [string, IndexKeys])[];

	/**
	 * The keyspace is linked to, if none is provided defaults to whatever one is in use currently, if the keyspace does not exist we will create it for oyu
	 */
	keyspace?: string;

	metaData?: {
		/**
		 * Ignore's stuff like "XXX is a reserved keyword prefixing it with a _" etc
		 */
		ignoreWarnings?: boolean;
		/**
		 * This lets you migrate data in the background.
		 *
		 * How this works is simple. When the current time matches one of the ones in setTimes, we will query the database for any versions under the max version and migrate them. Since we forcefully made a index on the version, we can easily query for the data -> then migrate it
		 *
		 * This is AMAZING if you change versions of stuff often and want to keep the data up to date and not have it slow down when someone queries it
		 */
		migration?: {
			/**
			 * How much data at a time to query, defaults to 250
			 */
			atATime?: number;
			/**
			 * The max version to migrate to
			 */
			maxVersion?: number;
			/**
			 * What times to migrate data, if you know at X time the server is at a low usage, you can set this to that time
			 *
			 * [0] = Start time
			 * [1] = End time
			 *
			 * NOTE: The table does have two functions you can call to manually migrate data, so you can do it whenever you want as well.
			 */
			setTimes?: [number | string, number | string][];
			/**
			 * If we even should slowly migrate the data.
			 */
			shouldSlowlyMigrate?: boolean;
		};
		missingLocalColumns?: "ask" | "delete" | "ignore" | "warn";
		missingLocalIndexes?: "ask" | "delete" | "ignore";
		missingRemoteColumns?: "ask" | "ignore" | "insert" | "warn";
		missingRemoteIndexes?: "ask" | "create" | "ignore" | "warn";
	};

	/**
	 * Migrate old versions of the table to the new version
	 */
	migrationScripts?: {
		[version: number]: {
			/**
			 * An optional field for debugging purposes
			 */
			changes?: string;
			fields: string[] | "*";
			/**
			 * The migration script
			 *
			 * @param client The client for the database
			 * @param data The data to migrate
			 * @param version The current version of the data (mainly for the -1 migration)
			 * @returns The migrated data OR null. In the case it returns null, we re-query the data. This is so you can delete the row, then re-insert it with new data
			 */
			migrate(client: Client, data: unknown, version: number): Promise<unknown | null> | unknown | null;
		};
		/**
		 * -1 is ran for every version, its in case you want to have your own custom migration script
		 */
		"-1"?: {
			/**
			 * An optional field for debugging purposes
			 */
			changes?: string;
			fields: string[] | "*";
			/**
			 * The migration script
			 *
			 * @param client The client for the database
			 * @param data The data to migrate
			 * @param version The current version of the data (mainly for the -1 migration)
			 * @returns The migrated data OR null. In the case it returns null, we re-query the data. This is so you can delete the row, then re-insert it with new data
			 */
			migrate(client: Client, data: unknown, version: number): Promise<unknown | null> | unknown | null;
		};
		/**
		 * 0 is only ran when the data has no version, this could be you at a later point in time adding a version to the table
		 */
		"0"?: {
			/**
			 * An optional field for debugging purposes
			 */
			changes?: string;
			fields: string[] | "*";
			/**
			 * The migration script
			 *
			 * @param client The client for the database
			 * @param data The data to migrate
			 * @param version The current version of the data (mainly for the -1 migration)
			 * @returns The migrated data OR null. In the case it returns null, we re-query the data. This is so you can delete the row, then re-insert it with new data
			 */
			migrate(client: Client, data: unknown, version: number): Promise<unknown> | unknown;
		};
	};

	/**
	 * The "mode" for the columns casing
	 */
	mode?: "camelCase" | "PascalCase" | "snake_case";

	/**
	 * These are the primary keys for the table
	 * i.e "PRIMARY KEY (k1, k2)" or "PRIMARY KEY ((k1, k2), k3))"
	 */
	primaryKeys: PrimaryKeys[];
	tableName: string;

	types?: Types;

	/**
	 * Version is forcefully injected as a column, we name it "int_tbl_ver" and its a normal int. You may choose to rename it if you wish
	 * If you want to use a custom version, you can provide a tuple with the first value being the name and the second being the version
	 */
	version?: number | [string, number];
	/**
	 * The options for the table
	 */
	with?: CassandraTableOptions;
}

export type ExtractTypesFromCreateTable<T> = T extends Options<infer _Z, infer U, infer _P, infer _I>
	? ConvertObjectToNormal<U>
	: T extends Table<infer T>
		? ExtractTypesFromCreateTable<T>
		: never;

export type NullifyStuff<T> = {
	// if the item is an array it cannot be null
	[K in keyof T]: T[K] extends (infer U)[] ? U[] : T[K] | null;
};

export type PublicGetReturnType<T, Fields extends (keyof T)[] | "*" = "*"> = Fields extends "*"
	? NullifyStuff<T>
	: NullifyStuff<Pick<T, Extract<keyof T, Fields[number]>>>;

const mappings = {
	date: "timestamp",
	string: "text",
	number: "int",
};

export const reservedNames = [
	"partition_key",
	"cluster_key",
	"key",
	"column1",
	"value",
	"writetime",
	"ttl",
	"add",
	"all",
	"allow",
	"alter",
	"and",
	"apply",
	"asc",
	"authorize",
	"batch",
	"begin",
	"by",
	"columnfamily",
	"create",
	"delete",
	"desc",
	"drop",
	"from",
	"grant",
	"in",
	"index",
	"insert",
	"into",
	"keyspace",
	"limit",
	"modify",
	"of",
	"on",
	"order",
	"primary",
	"rename",
	"revoke",
	"schema",
	"select",
	"set",
	"table",
	"to",
	"token",
	"truncate",
	"update",
	"use",
	"using",
	"where",
	"with",
];

export const snakeifyString = (str: string) => {
	const replaced = str.replaceAll(/(?<item1>[\da-z]|(?=[A-Z]))(?<item2>[A-Z])/g, "$1_$2").toLowerCase();

	if (reservedNames.includes(replaced)) {
		return `${replaced}_`;
	}

	return replaced;
};

export const convertToCorrectType = (type: string) => {
	if (mappings[type as keyof typeof mappings]) {
		return mappings[type as keyof typeof mappings];
	}

	return type;
};

export const ExtractValueName = <T extends AllTypes>(type: T): AllTypes => {
	// ? basically the FreezeType just without freezing the type
	if (typeof type === "string") {
		return convertToCorrectType(snakeifyString(type)).toString() as AllTypes;
	}

	if (Array.isArray(type)) {
		return `list<${ExtractValueName(type[0])}>`.toString() as AllTypes;
	}

	return convertToCorrectType(snakeifyString(type.name)).toString() as AllTypes;
};

/**
 * Turn a {@link ColumnTypesRaw} or {@link ColumnTypesStrings} into a {@link FrozenTypes} or {@link ListableTypes}
 */
export const FreezeType = <T extends FrozenlessTypes>(type: T): ConvertType<T> => {
	if (typeof type === "string") {
		if (type.startsWith("frozen<") || type.startsWith("list<frozen<")) {
			return type.toLowerCase() as ConvertType<T>;
		}

		if (type.startsWith("list<")) {
			// ? we extract the type from the list
			const extractedType = type.slice(5, -1);

			return `list<${FreezeType(convertToCorrectType(extractedType.toLowerCase()) as FrozenlessTypes)}>` as ConvertType<T>;
		}

		return `frozen<${convertToCorrectType(type.toLowerCase())}>` as ConvertType<T>;
	}

	if (Array.isArray(type)) {
		return `list<${FreezeType(type[0])}>`.toLowerCase() as ConvertType<T>;
	}

	return `frozen<${convertToCorrectType(type.name.toLowerCase())}>` as ConvertType<T>;
};
