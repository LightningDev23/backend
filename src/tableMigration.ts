import App from "./Utils/Classes/App.ts";

new App("MIG");

import Client from "./Utils/Classes/DB/Client.ts";

import ConfigManager from "./Utils/Classes/ConfigManager.ts";
import * as tables from "@/Utils/Cql/Tables/Tables.ts";

const cfg = new ConfigManager();

await cfg.load();

const config = cfg.config!;

await Client.getInstance().connect({
	keyspace: config.scyllaDB.keyspace,
	nodes: config.scyllaDB.nodes,
	password: config.scyllaDB.password,
	username: config.scyllaDB.username,
	db: {
		durableWrites: config.scyllaDB.durableWrites,
		networkTopologyStrategy: config.scyllaDB.networkTopologyStrategy,
	},
});

console.log("Done", tables);

process.exit();
