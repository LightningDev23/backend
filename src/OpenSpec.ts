// TODO: Finish the OpenSpec file, this is a WIP

import { join } from "node:path";
import type { Type } from "ts-morph";
import { ModuleKind, ModuleResolutionKind, NewLineKind, Project, ScriptTarget, TypeFlags, ts } from "ts-morph";
import { ModuleDetectionKind } from "typescript";
import FileSystemRouter from "./Utils/Classes/FileSystemRouter.ts";
import Route from "./Utils/Classes/Routing/Route.ts";

const router = new FileSystemRouter({
	dir: join(import.meta.dirname, "./Routes"),
	style: "nextjs",
	watch: false,
});

const project = new Project({
	compilerOptions: {
		allowUnreachableCode: false,
		allowUnusedLabels: false,
		exactOptionalPropertyTypes: true,
		noFallthroughCasesInSwitch: true,
		noImplicitOverride: true,
		noImplicitReturns: true,
		noUnusedLocals: true,
		noUnusedParameters: true,
		strict: true,
		useUnknownInCatchVariables: true,
		noUncheckedIndexedAccess: true,
		module: ModuleKind.ESNext,
		moduleResolution: ModuleResolutionKind.Bundler,
		resolveJsonModule: true,
		declaration: true,
		declarationMap: true,
		importHelpers: true,
		inlineSources: true,
		newLine: NewLineKind.LineFeed,
		noEmitHelpers: true,
		outDir: "dist",
		removeComments: false,
		sourceMap: true,
		esModuleInterop: true,
		forceConsistentCasingInFileNames: true,
		experimentalDecorators: true,
		lib: ["esnext"],
		target: ScriptTarget.ESNext,
		useDefineForClassFields: true,
		types: ["bun-types"],
		skipLibCheck: true,
		allowJs: true,
		noEmit: true,
		allowImportingTsExtensions: true,
		moduleDetection: ModuleDetectionKind.Force,
		noErrorTruncation: true, // darkerink: this is just so I can see the full types
		paths: {
			"@/*": ["./src/*"],
		},
	},
});

const allowedMethods = ["get", "post", "put", "patch", "delete", "head", "options"];
const typechecker = project.getTypeChecker();

const serializeTypeToJson = (returnType: Type<ts.Type>, loop?: number): any => {
	if (loop && loop >= 200) {
		return "MAX_LOOP_REACHED";
	}

	if (!loop) {
		// biome-ignore lint/style/noParameterAssign: Its fine
		loop = 0;
	}

	if (returnType.getFlags() & TypeFlags.Object && !returnType.isArray() && !returnType.isTuple()) {
		const obj: Record<string, unknown> = {};

		// ? if its a "date" return "Date"
		if (returnType.getText() === "Date") {
			return "Date";
		}

		for (const prop of returnType.getProperties()) {
			if (!prop.getValueDeclaration()) {
				continue;
			}

			obj[prop.getName()] = serializeTypeToJson(
				typechecker.getTypeOfSymbolAtLocation(prop, prop.getValueDeclaration()!),
				// biome-ignore lint/style/noParameterAssign: Its fine
				++loop,
			);
		}

		return obj;
	} else if (returnType.getFlags() & TypeFlags.Union) {
		const types = returnType.getUnionTypes();

		// biome-ignore lint/style/noParameterAssign: Its fine
		return types.map((type) => serializeTypeToJson(type, ++loop!));
	} else if (returnType.getFlags() & TypeFlags.Intersection) {
		const types = returnType.getIntersectionTypes();

		// biome-ignore lint/style/noParameterAssign: Its fine
		return types.map((type) => serializeTypeToJson(type, ++loop!));
	} else if (returnType.getFlags() & TypeFlags.String) {
		return "string";
	} else if (returnType.getFlags() & TypeFlags.Number) {
		return "number";
	} else if (returnType.getFlags() & TypeFlags.Boolean) {
		return "boolean";
	} else if (returnType.getFlags() & TypeFlags.Any) {
		return "any";
	} else if (returnType.getFlags() & TypeFlags.Unknown) {
		return "unknown";
	} else if (returnType.getFlags() & TypeFlags.Null) {
		return "null";
	} else if (returnType.getFlags() & TypeFlags.Undefined) {
		return "undefined";
	} else if (returnType.getFlags() & TypeFlags.Void) {
		return "void";
	} else if (returnType.getFlags() & TypeFlags.Never) {
		return "never";
	} else if (returnType.getFlags() & TypeFlags.BigInt) {
		return "bigint";
	} else if (returnType.getFlags() & TypeFlags.Object && returnType.isArray() && !returnType.isTuple()) {
		const typeArgs = returnType.getTypeArguments();

		if (typeArgs.length === 1) {
			// biome-ignore lint/style/noParameterAssign: Its fine
			return [serializeTypeToJson(typeArgs[0]!, ++loop!)];
		}

		return [];
	} else if (returnType.getFlags() & TypeFlags.Object && returnType.isTuple()) {
		const typeArgs = returnType.getTypeArguments();

		// biome-ignore lint/style/noParameterAssign: Its fine
		return typeArgs.map((type) => serializeTypeToJson(type, ++loop!));
	} else if (returnType.getFlags() & TypeFlags.BooleanLiteral) {
		return returnType.getText();
	} else if (returnType.getFlags() & TypeFlags.StringLiteral) {
		return returnType.getText().replaceAll('"', "");
	}

	console.warn("Unknown type", returnType.getFlags(), returnType.getText());

	return "unknown";
};

const getErrors = (str: string) => {
	const cleanedString = str.replaceAll(/,\s*}/g, "}").replaceAll(/,\s*]/g, "]").replaceAll(/\s+/g, " ");

	const regex = /{\s*(?<code>(?:[\w$]+|\[[^\]]+]))\s*:\s*{(?<data>(?:[^{}]|{[^}]*})*)}\s*}/;
	const match = regex.exec(cleanedString);

	if (match) {
		const objName = match[1];

		const codeRegex = /code:\s*"(?<code>[^"]+)"/;
		const messageRegex = /message:\s*(?<message>["'`][^"'](?<actualtext>.*)["'`])/;

		const codeMatch = match[2]?.match(codeRegex);
		const messageMatch = match[2]?.match(messageRegex);

		if (codeMatch && messageMatch) {
			const code = codeMatch[1];
			const message = messageMatch[1]?.slice(1, -1);

			return { objName, code, message };
		} else {
			console.warn("Missing something", codeMatch, messageMatch, cleanedString);

			return null;
		}
	} else {
		console.warn("Could not parse error", cleanedString);
	}

	return null;
};

const dd = [];

for (const [name, route] of Object.entries(router.routes)) {
	const routeClass = await import(route);

	if (!routeClass.default) {
		throw new Error(`Route ${name} does not have a default export, cannot generate spec`);
	}

	const routeInstance = new routeClass.default(); // Nothing gets ran so we don't need to provide an "App"

	if (!(routeInstance instanceof Route)) {
		throw new TypeError(`Route ${name} is not an instance of Route, cannot generate spec`);
	}

	// console.log("Route", name, routeClass.default.name);
	// console.log("Methods", routeInstance.__methods);
	// console.log("Middlewares", routeInstance.__middlewares);
	// console.log("Content Types", routeInstance.__contentTypes);
	// console.log("Descriptions", routeInstance.__descriptions);

	project.addSourceFileAtPath(route);

	const source = project.getSourceFileOrThrow(route);
	const classes = source.getClasses()[0]!;

	if (classes.getExtends()?.getText() !== "Route") {
		throw new Error(`Route ${name} does not extend Route, cannot generate spec`);
	}

	const methods = classes.getMethods();

	const filtered = methods.filter((method) => {
		const decorators = method.getDecorators();
		const decs = decorators?.map((dec) => dec.getText());
		const methodDec = decs?.find((dec) => dec.includes("Method"));
		const args = decorators.map((dec) => dec.getArguments().map((arg) => arg.getText().replaceAll('"', "")));

		if (!methodDec) {
			return false;
		}

		return Boolean(args.some((arg) => arg.some((a) => allowedMethods.includes(a))));
	});

	const returnTypes = filtered.map((method) => {
		if (method.getReturnType().getText().includes("Promise")) {
			const typeArgs = method.getReturnType().getTypeArguments();

			// get any "addError" method calls that are inside the method
			const addErrorCalls = method.getDescendantsOfKind(ts.SyntaxKind.CallExpression).filter((call) => {
				const exp = call.getExpression();
				const expName = exp?.getText();

				return expName.endsWith("addError");
			});

			// filter duplicates (same error code and objName)
			const errorArgs = addErrorCalls
				.map((call) => {
					const args = call.getArguments();
					return args[0]!.getText();
				})
				.map(getErrors)
				.filter(Boolean)
				.filter((error, index, self) => {
					return self.findIndex((e) => e?.code === error?.code && e?.objName === error?.objName) === index;
				});

			return {
				type: "Promise",
				methodName: method.getName(),
				description: routeInstance.__descriptions.find((desc) => desc.name === method.getName())?.description ?? "",
				method: routeInstance.__methods.find((meth) => meth.name === method.getName())?.method ?? "get",
				returnType: serializeTypeToJson(typeArgs[0]!),
				errors: errorArgs,
			};
		}

		const addErrorCalls = method.getDescendantsOfKind(ts.SyntaxKind.CallExpression).filter((call) => {
			const exp = call.getExpression();
			const expName = exp?.getText();

			return expName.endsWith("addError");
		});

		const errorArgs = addErrorCalls
			.map((call) => {
				const args = call.getArguments();
				return args[0]!.getText();
			})
			.map(getErrors)
			.filter(Boolean)
			.filter((error, index, self) => {
				return self.findIndex((e) => e?.code === error?.code && e?.objName === error?.objName) === index;
			});

		// middleware

		return {
			type: "NonPromise",
			name: method.getName(),
			description: routeInstance.__descriptions.find((desc) => desc.name === method.getName())?.description ?? "",
			method: routeInstance.__methods.find((meth) => meth.name === method.getName())?.method ?? "get",
			returnType: serializeTypeToJson(method.getReturnType()),
			errors: errorArgs,
		};
	});

	dd.push({
		types: returnTypes,
		name,
	});
}

const unFinishedRoutes = dd
	.map((y) => ({
		types: y.types.filter(
			(x) =>
				x.errors.length === 0 &&
				Object.values(x.returnType).length === 0 &&
				x.type === "NonPromise" &&
				x.description === "Change this Description when working on this route",
		),
		path: y.name,
	}))
	.filter((x) => x.types.length > 0);

dd.push({
	name: "Routes that are not finished yet",
	routes: unFinishedRoutes.flatMap((route) =>
		route.types.map((x) => ({ name: x.name, method: x.method, path: route.path })),
	),
});

await Bun.write("./openSpecStorage/raw.json", JSON.stringify(dd.reverse(), null, 4));

process.exit(0);
