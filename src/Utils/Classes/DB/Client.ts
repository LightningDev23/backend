import { EventEmitter } from "node:events";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import cassandra, { type ClientOptions } from "@kastelapp/cassandra-driver";
import App from "@/Utils/Classes/App.ts";
import ListenerMap from "@/Utils/Classes/ListenerMap.ts";
import safePromise from "@/Utils/safePromise.ts";
import type Table from "./Table.ts";

const possibleYes = ["y", "yes", "yeah", "sure", "ok"];

interface Client {
    emit(event: "Error", error: unknown): boolean;
    emit(event: "Close" | "Connected"): boolean;
    on(event: "Error", listener: (error: unknown) => void): this;
    on(event: "Close" | "Connected", listener: () => void): this;
}

interface OurClientOptions {
    db?: {
        durableWrites?: boolean;
        networkTopologyStrategy?: {
            [DataCenter: string]: number;
        };
        options?: Omit<ClientOptions, "credentials" | "keyspace">;
    },
    keyspace: string;
    nodes: string[];
    password: string;
    username: string;
}

class Client extends EventEmitter {
    private static instance: Client;

    // @ts-expect-error -- Its fine
    public static tables: ListenerMap<string, Table<infer _T>> = new ListenerMap();

    public constructor() {
        super();

        Client.instance = this;
    }

    public connected: boolean = false;

    #connection!: cassandra.Client;

    public get connection() {
        return this.#connection;
    }

    public static getInstance(): Client {
        if (!Client.instance) {
            Client.instance = new Client();
        }

        return Client.instance;
    }

    public async connect(options: OurClientOptions) {
        this.#connection = new cassandra.Client({
            contactPoints: options.nodes,
            localDataCenter: options.db?.networkTopologyStrategy
                ? Object.keys(options.db?.networkTopologyStrategy)?.[0] ?? "datacenter1"
                : "datacenter1",
            credentials: {
                username: options.username,
                password: options.password,
            },
            ...options,
        });


        const [, error] = await safePromise(this.connection.connect());

        if (error) {
            throw new Error(`Failed to connect to Cassandra: ${error.message}`);
        }

        let createKeySpace = `CREATE KEYSPACE IF NOT EXISTS ${options.keyspace}`;

        if (options.db?.networkTopologyStrategy && Object.keys(options.db?.networkTopologyStrategy).length > 0) {
            createKeySpace += ` WITH REPLICATION = { 'class' : 'NetworkTopologyStrategy' ${Object.entries(
                options.db?.networkTopologyStrategy,
            )
                .map(([DataCenter, ReplicationFactor]) => `, '${DataCenter}' : ${ReplicationFactor}`)
                .join(", ")} }`;
        } else {
            createKeySpace += " WITH REPLICATION = { 'class' : 'SimpleStrategy', 'replication_factor' : 1 }";
        }

        createKeySpace += ` AND DURABLE_WRITES = ${options.db?.durableWrites ?? false};`;

        const [, keyspaceError] = await safePromise(this.connection.execute(createKeySpace));

        if (keyspaceError) {
            throw new Error(`Failed to create keyspace: ${keyspaceError.message}`);
        }

        const [, useKeySpaceError] = await safePromise(this.connection.execute(`USE ${options.keyspace}`));

        if (useKeySpaceError) {
            throw new Error(`Failed to use keyspace: ${useKeySpaceError.message}`);
        }

        Client.tables.on("change", async (table) => {
            if (!table || !Client.instance.connected) return;

            await this.handleTable(options.keyspace, table);
        });

        for (const table of Client.tables.values()) {
            // ? we got to query the tables metadata to confirm everything matches what the table is set to currently
            await this.handleTable(options.keyspace, table);
        }

        this.emit("Connected");

        this.connected = true;
    }

    // @ts-expect-error -- Its fine
    private async handleTable(keyspace: string, table: Table<_T>) {
        const tableCommand = `SELECT * FROM system_schema.tables WHERE keyspace_name = '${keyspace}' AND table_name = '${table.snakeifyString(table.options.tableName)}'`;
        const columnsCommand = `SELECT * FROM system_schema.columns WHERE keyspace_name = '${keyspace}' AND table_name = '${table.snakeifyString(table.options.tableName)}'`;
        const indexesCommand = `SELECT * FROM system_schema.indexes WHERE keyspace_name = '${keyspace}' AND table_name = '${table.snakeifyString(table.options.tableName)}'`;

        const [data, error] = await safePromise(this.connection.execute(tableCommand));

        if (error || !data) {
            throw new Error(`Failed to get table metadata: ${error?.message}`);
        }

        if (data.rows.length === 0) {
            const cmd = table.toCQLCommand();

            for (const type of cmd.types) {
                const [, error] = await safePromise(this.connection.execute(type));

                if (error) {
                    throw new Error(`Failed to create type: ${error.message}`);
                }

                App.staticLogger.info(`Created type ${type}`);
            }

            const [, error] = await safePromise(this.connection.execute(cmd.table));

            console.log(cmd.table);

            if (error) {
                throw new Error(`[${table.snakeifyString(table.options.tableName)}] Failed to create table: ${error.message}`);
            }

            App.staticLogger.info(`Created table ${table.snakeifyString(table.options.tableName)}`);

            for (const index of cmd.indexes) {
                const [, error] = await safePromise(this.connection.execute(index));

                if (error) {
                    throw new Error(`Failed to create index: ${error.message}`);
                }

                // ? get the part after INDEX or EXISTS 
                const indxName = index.replace(/CREATE INDEX (?:IF NOT EXISTS )?/, "").replace(/ ON .*/, "");

                App.staticLogger.info(`Created index ${indxName}`);
            }

            // ? We return due to the fact there's nothing else for us to do
            return;
        }

        const [columns, columnsError] = await safePromise(this.connection.execute(columnsCommand));

        // console.log(Bun.inspect(columns, { colors: true, depth: 50 }));

        if (columnsError || !columns) {
            throw new Error(`Failed to get columns metadata: ${columnsError?.message}`);
        }

        const [indexes, indexesError] = await safePromise(this.connection.execute(indexesCommand));

        if (indexesError || !indexes) {
            throw new Error(`Failed to get indexes metadata: ${indexesError?.message}`);
        }

        const columnNames = columns.rows.map((row) => ({
            name: row.column_name,
            type: row.type,
            kind: row.kind,
            position: row.position,
            clusteringOrder: row.clustering_order,
        }));

        const indexColumns = indexes.rows.map((row) => ({
            name: row.index_name,
            king: row.kind,
            target: row.options.target,
        }));

        const remotePrimaryKeys = columnNames.filter((column) => column.kind === "partition_key" || column.kind === "clustering");

        const fixedPrimaryKeys: [string[] | string, ...string[]] = remotePrimaryKeys.reduce<[{ name: string, pos: number; }[], ...{ name: string; pos: number; }[]]>((acc, key) => {
            if (key.kind === "partition_key") {
                acc[0].push({ name: key.name, pos: key.position });
            } else {
                acc.push({ name: key.name, pos: key.position });
            }

            return acc;
        }, [[]]).reduce<[string[] | string, ...string[]]>((acc, key) => {
            if (Array.isArray(key)) {
                key.sort((a, b) => a.pos - b.pos);

                // ? if the length is 1, we just want the name
                if (key.length === 1) {
                    acc[0] = key[0]!.name;
                } else {
                    acc[0] = key.map((k) => k.name);
                }
            } else {
                acc.push(key.name);
            }

            return acc;
        }, [[]]);


        // ? In a perfect world we would be able to create the new table for the user and then migrate the data over, but we are not in a perfect world
        // ? it could possibly take a long time to migrate the data over, so we will just throw an error and let the user handle it
        if (!Bun.deepEquals(fixedPrimaryKeys, table.options.primaryKeys.map((k) => Array.isArray(k) ? k.map((k) => table.snakeifyString(k)) : table.snakeifyString(k)))) {
            console.log(remotePrimaryKeys, fixedPrimaryKeys, table.options.primaryKeys.map((k) => Array.isArray(k) ? k.map((k) => table.snakeifyString(k)) : table.snakeifyString(k)));
            throw new Error(`The primary keys for the table ${table.snakeifyString(table.options.tableName)} have changed, we cannot change a tables primary key, please backup the data and recreate the table`);
        }

        // ? compare index keys, if there's a missing one from our local table, delete it from remote. Now if our local has a new index key, WE CAN add it
        // ? we just got to re-create it
        const remoteIndexKeys = indexColumns.map((column) => ({ name: column.name, target: column.target }));

        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        if (!table.options.indexes && remoteIndexKeys.length > 1 && remoteIndexKeys[0]!.name !== `${table.snakeifyString(table.options.tableName)}_inx_${table.snakeifyString(table.versionName)}`) {
            const answer = await rl.question(`The table ${table.snakeifyString(table.options.tableName)} has indexes that are not in the local table, would you like to remove them? [y/n] `);

            if (possibleYes.includes(answer)) {
                for (const index of indexColumns) {
                    const [, error] = await safePromise(this.connection.execute(`DROP INDEX ${index.name}`));

                    if (error) {
                        throw new Error(`Failed to drop index ${index.name}: ${error.message}`);
                    }

                    App.staticLogger.info(`Dropped index ${index.name}`);
                }
            }
        }

        if (table.options.indexes) {
            for (const [name, target] of table.options.indexes.map((idx) => Array.isArray(idx) ? [idx[0], table.snakeifyString(idx[1])] : [`${table.snakeifyString(table.options.tableName)}_inx_${table.snakeifyString(idx)}`, table.snakeifyString(idx)])) {
                if (!remoteIndexKeys.some((index) => index.name === name)) {
                    const [, error] = await safePromise(this.connection.execute(`CREATE INDEX IF NOT EXISTS ${name} ON ${table.snakeifyString(table.options.tableName)} (${table.snakeifyString(target as string)})`));

                    if (error) {
                        throw new Error(`[${table.snakeifyString(table.options.tableName)}] Failed to create index ${name}: ${error.message}`);
                    }

                    App.staticLogger.info(`Created index ${name}`);
                }
            }

            for (const index of indexColumns) {
                if (index.name === `${table.snakeifyString(table.options.tableName)}_inx_${table.snakeifyString(table.versionName)}`) continue;

                const indexKey = table.options.indexes.find((idx) => {
                    const name = Array.isArray(idx) ? idx[0] : `${table.snakeifyString(table.options.tableName)}_inx_${table.snakeifyString(idx)}`;

                    return name === index.name;
                });

                if (!indexKey) {
                    const answer = await rl.question(`The index ${index.name} (target: ${index.target} | table: ${table.snakeifyString(table.options.tableName)}) is not in the local table, would you like to remove it? [y/n] `);

                    if (possibleYes.includes(answer)) {
                        const [, error] = await safePromise(this.connection.execute(`DROP INDEX ${index.name}`));

                        if (error) {
                            throw new Error(`Failed to drop index ${index.name}: ${error.message}`);
                        }

                        App.staticLogger.info(`Dropped index ${index.name}`);
                    }
                }
            }
        }

        if (table.versionName !== "") {
            // ? check if the version index / column is in remote, if it is not ask the user if they want to add the version column and index
            const versionColumn = columnNames.find((column) => column.name === table.versionName);

            if (!versionColumn) {
                const answer = await rl.question(`[${table.options.tableName}] The version column ${table.versionName} is not in the remote table, would you like to add it? [y/n] `);

                if (possibleYes.includes(answer)) {
                    const [, error] = await safePromise(this.connection.execute(`ALTER TABLE ${table.snakeifyString(table.options.tableName)} ADD ${table.versionName} int`));

                    if (error) {
                        throw new Error(`Failed to add version column ${table.versionName}: ${error.message}`);
                    }

                    App.staticLogger.info(`Added version column ${table.versionName}`);
                }
            }

            const versionIndex = indexColumns.find((index) => index.target === table.versionName);

            if (!versionIndex) {
                const answer = await rl.question(`[${table.options.tableName}] The version index ${table.snakeifyString(table.options.tableName)}_inx_${table.versionName} is not in the remote table, would you like to add it? [y/n] `);

                if (possibleYes.includes(answer)) {
                    const [, error] = await safePromise(this.connection.execute(`CREATE INDEX IF NOT EXISTS ${table.snakeifyString(table.options.tableName)}_inx_${table.snakeifyString(table.versionName)} ON ${table.snakeifyString(table.options.tableName)} (${table.versionName})`));

                    if (error) {
                        throw new Error(`Failed to create version index ${table.snakeifyString(table.options.tableName)}_inx_${table.snakeifyString(table.versionName)}: ${error.message}`);
                    }

                    App.staticLogger.info(`Created version index ${table.snakeifyString(table.options.tableName)}_inx_${table.snakeifyString(table.versionName)}`);
                }
            }
        }

        rl.close();
    }
}

export default Client;
