import {
	type ListAndFreezeType,
	ExtractValueName,
	reservedNames,
	type AllTypes,
	type Options,
} from "./createTableTypes.ts";

const handledWithOptions = (key: string, value: unknown) => {
	let builtValue = "";

	if (value === null || value === undefined) {
		return "";
	}

	if (key === "clustering_order") {
		return `CLUSTERING ${value}`;
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
					.map(([key, value]) => `'${key}': '${value}'`)
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
};

/**
 * Build a non clean CQL table.
 *
 * Note: The "uncleaned" portion means that the formatting is garbage but it should still work to run in cassandra
 */
const convertTableToCqlCommand = <
	Types extends Record<string, Record<string, AllTypes | ListAndFreezeType<keyof Types>>>,
	Columns extends Record<string, AllTypes | ListAndFreezeType<keyof Types>>,
	PrimaryKeys extends keyof Columns | [keyof Columns, keyof Columns],
	IndexKeys extends keyof Columns,
>(
	options: Options<Types, Columns, PrimaryKeys, IndexKeys>,
) => {
	const columns = Object.entries(options.columns).map(([key, value]) => {
		const correctValue = ExtractValueName(value as AllTypes);

		if (reservedNames.includes(key.toString())) {
			return `${key}_ ${correctValue}`;
		}

		return `${key} ${correctValue}`;
	});

	const types = Object.entries(options.types ?? {}).map(([key, value]): string => {
		const columns = Object.entries(value).map(([key, value]) => {
			return `${key} ${ExtractValueName(value as AllTypes)}`;
		});

		return `CREATE TYPE ${key} (${columns.join(",\n")});`;
	});

	const withOptions = Object.entries(options.with ?? {}).map(([key, value]) => handledWithOptions(key, value));

	const built = [
		types.join("\n"),
		`CREATE TABLE${options.ifNotExists ? " IF NOT EXISTS" : ""} ${options.tableName} (`,
		columns.map((k) => `\t ${k}`).join(",\n"),
		",",
		`\tPRIMARY KEY (${options.primaryKeys.map((key) => (Array.isArray(key) ? `(${key.join(", ")})` : key)).join(", ")})`,
		")",
		withOptions.length > 0 ? `WITH ${withOptions.join(" AND ")}` : "",
		";",
		"",
		"",
		(options.indexes ?? []).length > 0
			? options.indexes
					?.map((index) => {
						const name = Array.isArray(index) ? index[0] : null;

						return `CREATE INDEX IF NOT EXISTS ${name ? name : `${options.tableName}_inx_${index as string}`} ON ${options.tableName} (${String(Array.isArray(index) ? index[1] : index)});`;
					})
					.join("\n")
			: "",
	];

	return built.join("\n");
};

export default convertTableToCqlCommand;

export { handledWithOptions };
