import Table from "./Table.ts";
import type { Options, AllTypes, ListAndFreezeType } from "./createTableTypes.ts";

const createTable = <
	Types extends Record<string, Record<string, AllTypes | ListAndFreezeType<keyof Types>>>,
	Columns extends Record<string, AllTypes | ListAndFreezeType<keyof Types>>,
	PrimaryKeys extends keyof Columns | [keyof Columns, keyof Columns],
	IndexKeys extends keyof Columns,
>(
	options: Options<Types, Columns, PrimaryKeys, IndexKeys>,
) => {
	return new Table(options);
};

export default createTable;
