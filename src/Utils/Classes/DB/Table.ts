import Long from "long";
import App from "@/Utils/Classes/App.ts";
import safePromise from "@/Utils/safePromise.ts";
import Client from "./Client.ts";
import type {
	AllTypes,
	ConvertObjectToNormal,
	ConvertToActualType,
	ConvertTypesToTypes,
	ExtractTypesFromCreateTable,
	Options,
	PublicGetReturnType,
} from "./createTableTypes.ts";
import { reservedNames, ExtractValueName, snakeifyString } from "./createTableTypes.ts";
import Finder from "./Finder.ts";
import { inspect } from "bun";

const tableAndColumnNameRegex = /^[A-Z_a-z]\w*$/;

type MergeUnions<A, B> = A | B;

class Table<T> {
	readonly #_options: T;

	private batching = false;

	private batchCommands: {
		params: unknown[];
		query: string;
	}[] = [];

	public constructor(options: T) {
		this.#_options = Object.freeze(options);

		this.checker();
	}

	public get options() {
		return this.#_options as T extends Options<infer Types, infer Columns, infer PrimaryKeys, infer IndexKeys>
			? Options<Types, Columns, PrimaryKeys, IndexKeys>
			: never;
	}

	private checker() {
		if (!this.options.tableName || this.options.tableName.length === 0) {
			throw new Error("Table name is required");
		}

		if (reservedNames.includes(this.options.tableName)) {
			throw new Error(
				`The table name ${this.options.tableName} is a reserved name in Cassandra, you are required to change it to something else, here are some suggestions: ${this.options.tableName}_`,
			);
		}

		if (!this.options.columns || Object.keys(this.options.columns).length === 0) {
			throw new Error("Columns are required");
		}

		// ? If all keys are primary we should probably throw an error, unsure how cassandra actually handles it, although we probably don't want it anyways
		if (this.options.primaryKeys.length === Object.keys(this.options.columns).length) {
			throw new Error(
				"All columns are primary keys, this is not allowed, please have the minimal amount of primary keys",
			);
		}

		// ? now for indexes, if there's more then 75% of the columns as indexes, we should probably throw a warning
		if (
			this.options.indexes &&
			this.options.indexes.length > Math.floor(Object.keys(this.options.columns).length * 0.75)
		) {
			App.staticLogger.warn(
				"You have more then 75% of the columns as indexes, this is not recommended, please have the minimal amount of indexes",
			);
		}

		if (this.options.version !== undefined && (this.options.version === 0 || this.options.version === -1)) {
			throw new Error(
				"[Internal Error] Sorry, the version you provided is an internally used version, this will conflict with migration scripts. Please use a non zero, non negative number for the version",
			);
		}

		if (!tableAndColumnNameRegex.test(this.options.tableName)) {
			throw new Error(
				`The table name ${this.options.tableName} is invalid, it must match the regex ${tableAndColumnNameRegex}`,
			);
		}

		for (const key of Object.keys(this.options.columns)) {
			if (!tableAndColumnNameRegex.test(key)) {
				throw new Error(`The column name ${key} is invalid, it must match the regex ${tableAndColumnNameRegex}`);
			}

			if (reservedNames.includes(key)) {
				App.staticLogger.warn(
					`The column name ${key} is a reserved name in Cassandra, it is recommended to change it, we are prefixing it with an underscore`,
				);
			}
		}

		// @ts-expect-error -- unsure how to handle this correctly
		Client.tables.set(this.options.tableName, this);
	}

	public startBatching() {
		this.batching = true;
	}

	public async endBatching() {
		console.log(this.batchCommands);

		this.batchCommands = [];

		this.batching = false;
	}

	public extractType(input: AllTypes) {
		return ExtractValueName(input);
	}

	public async migrateData<Data = Record<string, unknown>>(
		data: Data,
		version: number,
		where: { [key: string]: unknown },
	): Promise<Data> {
		if (this.options.migrationScripts) {
			const migration = this.options.migrationScripts[version];

			if (!migration) {
				return data;
			}
			App.staticLogger.debug(
				`[${this.options.tableName}] Migrating data from version ${version} to ${version + 1} due to ${migration.changes}`,
			);

			const doWeHaveAllFields = Array.isArray(migration.fields)
				? migration.fields.every((field) => data[this.snakeifyString(field) as never] !== undefined)
				: Object.keys(data as never).length === Object.keys(this.options.columns).length;

			// ? So for this, we got to check the "where" to make sure we got all the primary keys / partition keys else it will throw an error when we try to update.
			// ? If we do NOT we set another boolean called "hasAllPrimary" if its false, we fetch those keys as well -> then we update the where object to include them
			// ? so we can then migrate the data
			
			const primaryKeys = this.options.primaryKeys.flat()
			
			let hasAllPrimary = primaryKeys.every((key) => Object.keys(where).includes(key));
			
			const keysToFetch = [];
			
			if (!hasAllPrimary) {
				// ? first check if data has the fields, if so just patch the where
				for (const key of primaryKeys) {
					if (!Object.keys(where).includes(key) && !Object.keys(data).includes(key)) {
						keysToFetch.push(key);
					}
					
					if (!Object.keys(where).includes(key)) {
						where[key] = data[key];
					}
				}
				
				// ? one last check to see if we have all the primary keys
				hasAllPrimary = primaryKeys.every((key) => Object.keys(where).includes(key));
			}
			
			if (!doWeHaveAllFields) {
				if (migration.fields === "*") {
					keysToFetch.push(...Object.keys(this.options.columns));
				} else {
					for (const field of migration.fields) {
						if (!Object.keys(data).includes(this.snakeifyString(field))) {
							keysToFetch.push(field as string);
						}
					}
				}
			}
			
			if (doWeHaveAllFields && hasAllPrimary) {
				const migratedData = migration.migrate(Client.getInstance(), structuredClone(data), version) as Data;

				// ? If something changed, update the data in the database
				if (Bun.deepEquals(migratedData, data)) {
					// ? nothing changed, but we still want to update the version
					const opts = {
						query: `UPDATE ${this.options.tableName} SET ${this.snakeifyString(this.versionName)} = ? WHERE ${Object.keys(
							where,
						)
							.map((key) => `${this.snakeifyString(key)} = ?`)
							.join(" AND ")};`,
						params: [version + 1, ...Object.values(where)],
					};

					const [, error] = await safePromise(Client.getInstance().connection.execute(opts.query, opts.params));

					if (error) {
						throw new Error(`[${this.options.tableName}] There was an error updating the data: ${error.message}`);
					}

					App.staticLogger.debug(
						`[${this.options.tableName}] No changes were made to the data, but the version was updated to ${version + 1}`,
					);
				} else {
					const opts = {
						query: `UPDATE ${this.options.tableName} SET ${
							migration.fields === "*"
								? Object.keys(migratedData as never)
										.map((f) => `${this.snakeifyString(f)} = ?`)
										.join(", ")
								: migration.fields
										.map((f) => this.snakeifyString(f as string))
										.map((f) => `${f} = ?`)
										.join(", ")
						}, ${this.snakeifyString(this.versionName)} = ? WHERE ${Object.keys(where)
							.map((key) => `${this.snakeifyString(key)} = ?`)
							.join(" AND ")};`,
						params: [
							...Object.values(
								Object.fromEntries(
									Object.entries(migratedData as never).filter(([key]) => !Object.keys(where).includes(key)),
								),
							),
							version + 1,
							...Object.values(where),
						],
					};

					const [, error] = await safePromise(Client.getInstance().connection.execute(opts.query, opts.params));

					if (error) {
						throw new Error(`[${this.options.tableName}] There was an error updating the data: ${error.message}`);
					}

					App.staticLogger.debug(`[${this.options.tableName}] The data has been updated to version ${version + 1}`);
				}

				// if version + 1 is less then the latest version, continue migrating
				if (version + 1 < this.version) {
					return this.migrateData(migratedData, version + 1, where);
				}

				return migratedData;
			}

			// ? else rip we now got to fetch more fields :/

			const opts = {
				query: `SELECT ${migration.fields === "*" ? "*" : keysToFetch.map((f) => this.snakeifyString(f as string)).join(", ")} FROM ${this.options.tableName} WHERE ${Object.keys(
					where,
				)
					.map((key) => `${this.snakeifyString(key)} = ?`)
					.join(" AND ")};`,
				params: Object.values(where),
			};

			const [fetchedData, error] = await safePromise(Client.getInstance().connection.execute(opts.query, opts.params));

			if (error) {
				throw new Error(`[${this.options.tableName}] There was an error fetching the data: ${error.message}`);
			}

			if (!fetchedData) {
				return data;
			}

			const first = fetchedData.first();

			const mappedTypes = Object.entries(this.options.columns).map(([key, value]) => {
				return {
					key: this.snakeifyString(key),
					value: ExtractValueName(value as AllTypes),
				};
			});

			const finishedData: Record<string, unknown> = {};

			for (const [key, value] of Object.entries(first)) {
				const foundMappedType = mappedTypes.find((type) => type.key === key);

				if (!foundMappedType) {
					continue;
				}

				// ? If the value is a array but the returned value is not an array (/null) we make it an array, this is due to cassandra returning null if the value is empty
				if (foundMappedType.value.toString().includes("list") && !value) {
					finishedData[this.convertBack(key)] = [];

					continue;
				}

				finishedData[this.convertBack(key)] = this.recursiveConvert(value);
			}

			// ? If we are missing where keys, add them
			if (!hasAllPrimary) {
				for (const key of primaryKeys) {
					if (!Object.keys(where).includes(key)) {
						where[key] = finishedData[key];
					}
				}
			}
			
			const migratedData = migration.migrate(Client.getInstance(), structuredClone(finishedData), version) as Data;

			if (Bun.deepEquals(migratedData, finishedData)) {
				// ? nothing changed, but we still want to update the version
				const opts = {
					query: `UPDATE ${this.options.tableName} SET ${this.snakeifyString(this.versionName)} = ? WHERE ${Object.keys(
						where,
					)
						.map((key) => `${this.snakeifyString(key)} = ?`)
						.join(" AND ")};`,
					params: [version + 1, ...Object.values(where)],
				};

				const [, error] = await safePromise(
					Client.getInstance().connection.execute(opts.query, opts.params, {
						prepare: true,
					}),
				);

				if (error) {
					throw new Error(`[${this.options.tableName}] There was an error updating the data: ${error.message}`);
				}

				App.staticLogger.debug(
					`[${this.options.tableName}] No changes were made to the data, but the version was updated to ${version + 1}`,
				);
			} else {
				const optMigration = Object.fromEntries(
					Object.entries(migratedData as never).filter(([key]) => !Object.keys(where).includes(key)),
				);

				const opts = {
					query: `UPDATE ${this.options.tableName} SET ${
						migration.fields === "*"
							? Object.keys(optMigration as never)
									.map((f) => `${this.snakeifyString(f)} = ?`)
									.join(", ")
							: migration.fields
									.map((f) => this.snakeifyString(f as string))
									.map((f) => `${f} = ?`)
									.join(", ")
					}, ${this.snakeifyString(this.versionName)} = ? WHERE ${Object.keys(where)
						.map((key) => `${this.snakeifyString(key)} = ?`)
						.join(" AND ")};`,
					params: [...Object.values(optMigration), version + 1, ...Object.values(where)],
				};

				const [, error] = await safePromise(
					Client.getInstance().connection.execute(opts.query, opts.params, {
						prepare: true,
					}),
				);

				if (error) {
					throw new Error(`[${this.options.tableName}] There was an error updating the data: ${error.message}`);
				}

				App.staticLogger.debug(`[${this.options.tableName}] The data has been updated to version ${version + 1}`);
			}

			// if version + 1 is less then the latest version, continue migrating
			if (version + 1 < this.version) {
				return this.migrateData(migratedData, version + 1, where);
			}

			return migratedData;
		}

		return data;
	}

	public async get<
		AdditionalColumns extends Record<string, AllTypes>,
		Fields extends (keyof this["options"]["columns"])[] | "*" = "*",
	>(
		filter: Partial<ExtractTypesFromCreateTable<this["options"]>>,
		options?: {
			/**
			 * This is for historical purposes, if you want to fetch specific columns which are no longer in local but you are CERTAIN they are in remote
			 */
			additionalColumns?: AdditionalColumns;
			allowFiltering?: boolean;
			fields?: Fields;
		},
	): Promise<
		| (PublicGetReturnType<ExtractTypesFromCreateTable<this["options"]>, Fields> &
				PublicGetReturnType<ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]>, Fields>)
		| null
	> {
		if (
			!options ||
			!options.fields ||
			options.fields === "*" ||
			options.fields.length === 0 ||
			options.fields.length === Object.keys(this.options.columns).length
		) {
			App.staticLogger.warn(
				`[${this.options.tableName}] You are fetching all fields, this is not recommended, please specify the fields you want to fetch`,
			);
		}

		const gotClient = Client.getInstance();

		if (!gotClient.connected) {
			throw new Error("The client is not connected yet.");
		}

		if (!options) {
			// biome-ignore lint/style/noParameterAssign: we need to assign it
			options = { fields: "*" as Fields };
		}

		if (Array.isArray(options.fields)) {
			if (!options.fields.includes(this.versionName)) {
				options.fields.push(this.versionName as string);
			}

			// ? we filter out any empty strings (due to version name) and any duplicates
			options.fields = Array.from(new Set(options.fields)).filter((f) => f !== "") as Fields;
		}

		const opts: {
			params: unknown[];
			query: string;
		} = {
			query: `SELECT ${options.fields === "*" || !options.fields ? "*" : options.fields.map((f) => this.snakeifyString(f as string))?.join(", ")} FROM ${this.options.tableName} WHERE ${Object.keys(
				filter,
			)
				.map((key) => `${this.snakeifyString(key)} = ?`)
				.join(" AND ")}${options.allowFiltering ? " ALLOW FILTERING" : ""} LIMIT 1;`,
			params: Object.values(filter).map((v) => {
				if (typeof v === "object") {
					return this.recursiveConvert(v, true);
				}

				return v;
			}),
		};

		const [data, error] = await safePromise(gotClient.execute(opts.query, opts.params, {
			prepare: true
		}));

		if (error) {
			// ? Note: this goes for all errors, the reason we re-throw them, is due to the STUPID damn nature of cassandra-driver
			// ? It throw's error's yes, but the stack is lost, so we re-throw it to get the stack
			throw new Error(`[${this.options.tableName}] There was an error fetching the data: ${error.message}`);
		}

		if (!data) {
			return null;
		}

		let finishedData: Partial<
			PublicGetReturnType<
				ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]> &
					ExtractTypesFromCreateTable<this["options"]>,
				Fields
			>
		> = {};

		const first = data?.first();

		const mappedTypes = Object.entries(this.options.columns).map(([key, value]) => {
			return {
				key: this.snakeifyString(key),
				value: ExtractValueName(value as AllTypes),
			};
		});

		for (const [key, value] of Object.entries(first)) {
			const foundMappedType = mappedTypes.find((type) => type.key === key);

			if (!foundMappedType) {
				continue;
			}

			// ? If the value is a array but the returned value is not an array (/null) we make it an array, this is due to cassandra returning null if the value is empty
			if (foundMappedType.value.toString().includes("list") && !value) {
				finishedData[
					this.convertBack(key) as keyof PublicGetReturnType<
						ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]> &
							ExtractTypesFromCreateTable<this["options"]>,
						Fields
					>
				] = [] as never;

				continue;
			}

			finishedData[
				this.convertBack(key) as keyof PublicGetReturnType<
					ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]> &
						ExtractTypesFromCreateTable<this["options"]>,
					Fields
				>
			] = this.recursiveConvert(value);
		}

		if (this.versionName !== "") {
			const version = first[this.versionName];

			if (!version) {
				finishedData = await this.migrateData(finishedData, 0, filter);
			}

			if (version && version < this.version) {
				finishedData = await this.migrateData(finishedData, version, filter);
			}
		}

		// ? If there's any extra data remove it, we only want to return what the user asked for
		if (options.fields !== "*" && options.fields) {
			for (const key of Object.keys(finishedData)) {
				if (!options.fields.includes(key as never)) {
					delete finishedData[key as never];
				}
			}
			
			// ? now if there's any keys we are missing, add it as null (unless its a list in which that case we add it as [])
			for (const key of options.fields) {
				if (!Object.keys(finishedData).includes(key as never)) {
					const foundMappedType = mappedTypes.find((type) => type.key === this.snakeifyString(key as string));

					if (!foundMappedType) {
						continue;
					}

					if (foundMappedType.value.toString().includes("list")) {
						finishedData[key as never] = [];
					} else {
						finishedData[key as never] = null;
					}
				}
			}
		}
		
		return finishedData as PublicGetReturnType<
			ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]> & ExtractTypesFromCreateTable<this["options"]>,
			Fields
		>;
	}

	private recursiveConvert(obj: Record<string, unknown> | unknown, inverse?: boolean) {
		if (Long.isLong(obj)) {
			return BigInt(obj.toString());
		}

		if (typeof obj !== "object") {
			return obj;
		}

		if (Array.isArray(obj)) {
			return obj.map((v) => this.recursiveConvert(v, inverse));
		}

		if (obj === null || obj === undefined || obj instanceof Date) {
			return obj;
		}

		const convert = inverse ? this.snakeifyString.bind(this) : this.convertBack.bind(this);

		const newObj: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(obj)) {
			if (Long.isLong(value)) {
				newObj[convert(key)] = BigInt(value.toString());
			} else if (typeof value === "object") {
				newObj[convert(key)] = Array.isArray(value)
					? value.map((v) => this.recursiveConvert(v, inverse))
					: this.recursiveConvert(value, inverse);
			} else {
				newObj[convert(key)] = value;
			}
		}

		return newObj;
	}

	public async update<
		AdditionalColumns extends Record<string, AllTypes>,
		Filter extends Partial<ExtractTypesFromCreateTable<this["options"]>>,
	>(
		filter: Filter,
		update: Omit<Partial<ExtractTypesFromCreateTable<this["options"]>>, keyof Filter>,
		options?: {
			/**
			 * This is for historical purposes, if you want to update specific columns which are no longer in local but you are CERTAIN they are in remote
			 */
			additionalColumns?: AdditionalColumns;

			/**
			 * If you want to set a specific version for the tbale, this is somewhat dangerous but if for whatever reason you want to sure
			 */
			version?: number;
		},
	) {
		if (Object.keys(update).length === 0) {
			throw new Error(`[${this.options.tableName}] You are trying to update with no values, this is not allowed`);
		}

		const gotClient = Client.getInstance();

		if (!gotClient.connected) {
			throw new Error("The client is not connected yet.");
		}

		const opts = {
			query: `UPDATE ${this.options.tableName} SET ${Object.entries(update)
				.map(([key]) => `${this.snakeifyString(key)} = ?`)
				.join(", ")}${options?.version ? `, ${this.versionName} = ${options.version}` : ""} WHERE ${Object.keys(filter)
				.map((key) => `${this.snakeifyString(key)} = ?`)
				.join(" AND ")};`,
			params: [...Object.values(update).map((v) => this.recursiveConvert(v, true)), ...Object.values(filter)],
		};

		const [, error] = await safePromise(gotClient.execute(opts.query, opts.params, {
			prepare: true
		}));

		if (error) {
			throw new Error(`[${this.options.tableName}] There was an error updating the data: ${error.message}`);
		}

		App.staticLogger.debug(`[${this.options.tableName}] The data has been updated`);
	}

	/**
	 * This is just a link to the delete function
	 */
	// ? we can only delete via primary keys, we can get them from infering from the options
	public async remove(
		filter: {
			// @ts-expect-error -- its fine
			[key in T extends Options<infer _Columns, infer PrimaryKeys, infer _IndexKeys>
				? PrimaryKeys
				: never]: ConvertToActualType<this["options"]["columns"][key]>;
		},
	) {
		await this.delete(filter);
	}

	public async delete(
		filter: {
			// @ts-expect-error -- its fine
			[key in T extends Options<infer _Columns, infer PrimaryKeys, infer _IndexKeys>
				? PrimaryKeys
				: never]: ConvertToActualType<this["options"]["columns"][key]>;
		},
	) {
		const gotClient = Client.getInstance();

		if (!gotClient.connected) {
			throw new Error("The client is not connected yet.");
		}

		const opts = {
			query: `DELETE FROM ${this.options.tableName} WHERE ${Object.keys(filter)
				.map((key) => `${this.snakeifyString(key)} = ?`)
				.join(" AND ")};`,
			params: Object.values(filter),
		};

		const [, error] = await safePromise(gotClient.execute(opts.query, opts.params, {
			prepare: true
		}));

		if (error) {
			throw new Error(`[${this.options.tableName}] There was an error deleting the data: ${error.message}`);
		}

		App.staticLogger.debug(`[${this.options.tableName}] The data has been deleted`);
	}

	public async create<Data extends Partial<ExtractTypesFromCreateTable<this["options"]>>>(
		data: Data,
		options?: {
			/**
			 * If you want to set a specific version for the tbale, this is somewhat dangerous but if for whatever reason you want to sure
			 */
			version?: number;
		},
	): Promise<Data> {
		if (Object.keys(data).length === 0) {
			throw new Error(`[${this.options.tableName}] You are trying to create with no values, this is not allowed`);
		}

		const gotClient = Client.getInstance();

		if (!gotClient.connected) {
			throw new Error("The client is not connected yet.");
		}

		const opts = {
			query: `INSERT INTO ${this.options.tableName} (${Object.keys(data)
				.map((key) => this.snakeifyString(key))
				.join(", ")}, ${this.snakeifyString(this.versionName)}) VALUES (${Object.keys(data)
				.map(() => "?")
				.join(", ")}, ${options?.version ? options.version : this.version});`,
			params: Object.values(data).map((v) => this.recursiveConvert(v, true)),
		};

		const [, error] = await safePromise(gotClient.execute(opts.query, opts.params, {
			prepare: true
		}));

		if (error) {
			throw new Error(`[${this.options.tableName}] There was an error creating the data: ${error.message}`);
		}

		App.staticLogger.debug(`[${this.options.tableName}] The data has been created`);

		return data;
	}
	
	/**
	 * Just for historical purposes, this is just a link to the create function
	 */
	public async insert<Data extends Partial<ExtractTypesFromCreateTable<this["options"]>>>(
		data: Data,
		options?: {
			/**
			 * If you want to set a specific version for the tbale, this is somewhat dangerous but if for whatever reason you want to sure
			 */
			version?: number;
		},
	): Promise<Data> {
		return this.create(data, options);
	}

	public async find<
		AdditionalColumns extends Record<string, AllTypes> = {},
		Fields extends (keyof this["options"]["columns"])[] | "*" = "*",
	>(
		filter: Partial<
			ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]> & ExtractTypesFromCreateTable<this["options"]>
		>,
		options?: {
			/**
			 * This is for historical purposes, if you want to fetch specific columns which are no longer in local but you are CERTAIN they are in remote
			 */
			additionalColumns?: AdditionalColumns;
			allowFiltering?: boolean;
			fields?: Fields;
			limit?: number;
		},
	): Promise<
	Finder<PublicGetReturnType<ExtractTypesFromCreateTable<this["options"]>, Fields> &
	PublicGetReturnType<ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]>, Fields>>
	> {
		if (
			!options ||
			!options.fields ||
			options.fields === "*" ||
			options.fields.length === 0 ||
			options.fields.length === Object.keys(this.options.columns).length
		) {
			App.staticLogger.warn(
				`[${this.options.tableName}] You are fetching all fields, this is not recommended, please specify the fields you want to fetch`,
			);
		}

		const gotClient = Client.getInstance();

		if (!gotClient.connected) {
			throw new Error("The client is not connected yet.");
		}

		if (!options) {
			// biome-ignore lint/style/noParameterAssign: we need to assign it
			options = { fields: "*" as Fields };
		}

		if (Array.isArray(options.fields)) {
			if (!options.fields.includes(this.versionName)) {
				options.fields.push(this.versionName as string);
			}

			// ? we filter out any empty strings (due to version name) and any duplicates
			options.fields = Array.from(new Set(options.fields)).filter((f) => f !== "") as Fields;
		}

		const opts: {
			params: unknown[];
			query: string;
		} = {
			query: `SELECT ${options.fields === "*" || !options.fields ? "*" : options.fields.map((f) => this.snakeifyString(f as string))?.join(", ")} FROM ${this.options.tableName} WHERE ${Object.keys(
				filter,
			)
				.map((key) => `${this.snakeifyString(key)} = ?`)
				.join(" AND ")}${options.allowFiltering ? " ALLOW FILTERING" : ""}${options.limit ? ` LIMIT ${options.limit}` : ""};`,
			params: Object.values(filter).map((v) => {
				if (typeof v === "object") {
					return this.recursiveConvert(v, true);
				}

				return v;
			}),
		};
		
		const [data, error] = await safePromise(gotClient.execute(opts.query, opts.params, {
			prepare: true
		}));
		
		if (error) {
			throw new Error(`[${this.options.tableName}] There was an error fetching the data: ${error.message}`);
		}
		
		if (!data) {
			return new Finder([]);
		}
		
		const mappedTypes = Object.entries(this.options.columns).map(([key, value]) => {
			return {
				key: this.snakeifyString(key),
				value: ExtractValueName(value as AllTypes),
			};
		});
		
		const finishedData: Partial<
			PublicGetReturnType<
				ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]> &
					ExtractTypesFromCreateTable<this["options"]>,
				Fields
			>
		>[] = [];
		
		for (const row of data) {
			let newObj: Record<string, unknown> = {};
			
			for (const [key, value] of Object.entries(row)) {
				const foundMappedType = mappedTypes.find((type) => type.key === key);
				
				if (!foundMappedType) {
					continue;
				}
				
				// ? If the value is a array but the returned value is not an array (/null) we make it an array, this is due to cassandra returning null if the value is empty
				if (foundMappedType.value.toString().includes("list") && !value) {
					newObj[
						this.convertBack(key) as keyof PublicGetReturnType<
							ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]> &
								ExtractTypesFromCreateTable<this["options"]>,
							Fields
						>
					] = [] as never;
					
					continue;
				}
				
				newObj[
					this.convertBack(key) as keyof PublicGetReturnType<
						ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]> &
							ExtractTypesFromCreateTable<this["options"]>,
						Fields
					>
				] = this.recursiveConvert(value);
			}
			
			if (this.versionName !== "") {
				const version = row[this.versionName];
				
				if (version === undefined) {
					newObj = await this.migrateData(newObj, 0, filter)
				}
				
				if (version !== undefined && version < this.version) {
					newObj = await this.migrateData(newObj, version, filter);
				}
			}
			
			finishedData.push(newObj);
		}
		
		// ? If there's any extra data remove it, we only want to return what the user asked for
		if (options.fields !== "*" && options.fields) {
			for (const obj of finishedData) {
				for (const key of Object.keys(obj)) {
					if (!options.fields.includes(key as never)) {
						delete obj[key as never];
					}
				}
				
				// ? now if there's any keys we are missing, add it as null (unless its a list in which that case we add it as [])
				for (const key of options.fields) {
					if (!Object.keys(obj).includes(key as never)) {
						const foundMappedType = mappedTypes.find((type) => type.key === this.snakeifyString(key as string));
						
						if (!foundMappedType) {
							continue;
						}
						
						if (foundMappedType.value.toString().includes("list")) {
							obj[key as never] = [];
						} else {
							obj[key as never] = null;
						}
					}
				}
			}
		}
		
		return new Finder(finishedData as PublicGetReturnType<
			ConvertObjectToNormal<AdditionalColumns, this["options"]["types"]> & ExtractTypesFromCreateTable<this["options"]>,
			Fields
		>);
	}

	/**
	 * Turn's camelCase / PascalCase strings into snake_case
	 */
	public snakeifyString(str: string) {
		return snakeifyString(str);
	}

	/**
	 * Converts snake_case strings into camelCase / PascalCase
	 */
	private convertBack(str: string) {
		const initalKey = str.endsWith("_") ? (reservedNames.includes(str.slice(0, -1)) ? str.slice(0, -1) : str) : str;

		if (this.options?.mode === "PascalCase") {
			return initalKey
				.split("_")
				.map((part) => part[0]!.toUpperCase() + part.slice(1))
				.join("");
		}

		if (this.options?.mode === "camelCase") {
			return initalKey
				.split("_")
				.map((part, index) => (index === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
				.join("");
		}

		return initalKey;
	}

	/**
	 * Export a table to a CQL command
	 *
	 * @returns The CQL string for the table
	 */
	public toCQLCommand() {
		const table = [
			`CREATE TABLE${this.options.ifNotExists ? " IF NOT EXISTS" : ""} ${this.options.keyspace ? `${this.options.keyspace}.` : ""}${this.snakeifyString(this.options.tableName)} (`,
			this.columns.map((k) => `\t ${k}`).join(",\n"),
			this.options.version === undefined ? "," : `,\t${this.snakeifyString(this.versionName)} int,`,
			`\tPRIMARY KEY (${this.options.primaryKeys.map((key) => (Array.isArray(key) ? `(${key.map((k) => this.snakeifyString(k)).join(", ")})` : this.snakeifyString(key))).join(", ")})`,
			")",
			this.withOptions.length > 0 ? `WITH ${this.withOptions.join(" AND ")}` : "",
			";",
		].join("\n");

		const types = Object.entries(this.options.types ?? {}).map(([key, value]): string => {
			const columns = Object.entries(value).map(([key, value]) => {
				return `${this.snakeifyString(key)} ${ExtractValueName(value)}`;
			});

			return `CREATE TYPE IF NOT EXISTS ${this.snakeifyString(key)} (${columns.join(",\n")});`;
		});

		const indexes = this.indexes;

		// ? yeah, I know this is technically bad BUT since the likelyhood of someone using this code elsewhere is low we do not care
		// ? we push a version index forcfully
		if (this.options.version !== undefined) {
			indexes.push(
				`CREATE INDEX IF NOT EXISTS ${this.options.tableName}_inx_${this.snakeifyString(this.versionName)} ON ${this.options.tableName} (${this.versionName});`,
			);
		}

		return {
			table,
			indexes,
			types,
		};
	}

	public get columns() {
		return Object.entries(this.options.columns).map(([key, value]) => {
			const correctValue = ExtractValueName(value as AllTypes);
			const convertedString = this.snakeifyString(key);

			if (reservedNames.includes(convertedString)) {
				console.warn(
					`The column name ${key} is a reserved name in Cassandra, it is recommended to change it, we are prefixing it with an underscore`,
				);

				return `${convertedString}_ ${correctValue}`;
			}

			return `${convertedString} ${correctValue}`;
		});
	}

	public get withOptions() {
		return Object.entries(this.options.with ?? {}).map(([key, value]) =>
			this.handleWithOptions(this.snakeifyString(key), value),
		);
	}

	public get indexes() {
		if (!this.options.indexes) {
			return [];
		}

		return this.options.indexes.map((index) => {
			const name = Array.isArray(index) ? index[0] : null;

			return `CREATE INDEX IF NOT EXISTS ${name ? name : `${this.options.tableName}_inx_${index as unknown as string}`} ON ${this.options.tableName} (${Array.isArray(index) ? index[1] : index});`;
		});
	}

	public get versionName() {
		return this.options.version === undefined
			? ""
			: Array.isArray(this.options.version)
				? this.options.version[0]
				: "int_tbl_ver";
	}

	public get version() {
		return this.options === undefined ? 0 : Array.isArray(this.options.version) ? this.options.version[1] : 0;
	}

	private handleWithOptions(key: string, value: unknown) {
		let builtValue = "";

		if (value === null || value === undefined) {
			return "";
		}

		switch (typeof value) {
			case "bigint":
			case "number":
			case "boolean": {
				builtValue = value.toString();

				break;
			}

			case "string": {
				builtValue = `'${value}'`;

				break;
			}

			case "object": {
				if (!Array.isArray(value)) {
					// ? turn value into {'keys': 'ALL', 'rows_per_partition': 'ALL'}
					builtValue = `{${Object.entries(value)
						.map(([key, value]) => `'${this.snakeifyString(key)}': '${value}'`)
						.join(", ")}}`;

					break;
				}

				builtValue = `[${value.join(", ")}]`;

				break;
			}

			default: {
				builtValue = "";
			}
		}

		return `${key} = ${builtValue}`;
	}

	/**
	 * If the table is currently migrating data
	 */
	public isMigrating = false;

	/**
	 * Start migrating data
	 */
	public async startMigration() {}

	/**
	 * Stop migrating data
	 */
	public async endMigration() {}
}

export default Table;
