import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const monumentaRoot = path.resolve(
	projectRoot,
	"../monumenta-plugins-public/plugins/paper/src/main/java/com/playmonumenta/plugins/depths",
);

const ownableTrees = [
	"DAWNBRINGER",
	"EARTHBOUND",
	"FLAMECALLER",
	"FROSTBORN",
	"SHADOWDANCER",
	"STEELSAGE",
	"WINDWALKER",
];

function parseBool(raw) {
	return raw.trim() === "true";
}

function splitWordsFromClassName(name) {
	return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function parseNumberList(raw) {
	return raw.split(",").map((value) => Number(value.trim()));
}

function parseSimpleNamePool(sourceText) {
	const results = [];
	const regex = /[A-Z0-9_]+\("([^"]+)",\s*(?:DepthsTree\.([A-Z_]+)|null)\)/g;
	for (const match of sourceText.matchAll(regex)) {
		const [, name, tree = null] = match;
		results.push({ name, tree });
	}
	return results;
}

function parseNounItems(sourceText) {
	const results = [];
	const regex =
		/[A-Z0-9_]+\("([^"]+)",\s*(?:DepthsTree\.([A-Z_]+)|null),\s*Material\.([A-Z_]+)\)/g;
	for (const match of sourceText.matchAll(regex)) {
		const [, name, tree = null, material] = match;
		results.push({ name, tree, material });
	}
	return results;
}

function parseAbilityMetadata(fileText, className) {
	const treeMatch = fileText.match(/DepthsTree\.([A-Z_]+)/);
	if (!treeMatch) {
		return null;
	}

	const abilityNameMatch = fileText.match(
		/public\s+static\s+final\s+String\s+ABILITY_NAME\s*=\s*"([^"]+)"/,
	);
	const inlineAbilityNameMatch = fileText.match(
		/new\s+DepthsAbilityInfo<[^>]*>\(\s*[^,]+,\s*"([^"]+)"/,
	);
	const cooldownEffectNameMatch = fileText.match(
		/public\s+static\s+final\s+String\s+CHARM_COOLDOWN\s*=\s*"([^"]+)"/,
	);
	const singleCharmMatch = fileText.match(/\.singleCharm\((true|false)\)/);
	const abilityName =
		abilityNameMatch?.[1] ||
		inlineAbilityNameMatch?.[1] ||
		splitWordsFromClassName(className);
	return {
		tree: treeMatch[1],
		abilityName,
		cooldownEffectName: cooldownEffectNameMatch
			? cooldownEffectNameMatch[1]
			: `${abilityName} Cooldown`,
		singleAbilityCharm: singleCharmMatch
			? parseBool(singleCharmMatch[1])
			: true,
	};
}

async function collectAbilityInfo() {
	const abilitiesDir = path.join(monumentaRoot, "abilities");
	const { stdout } = await import("node:child_process").then(
		({ execFile }) =>
			new Promise((resolve, reject) => {
				execFile(
					"find",
					[abilitiesDir, "-name", "*.java"],
					{ maxBuffer: 1024 * 1024 * 10 },
					(error, out) => {
						if (error) {
							reject(error);
							return;
						}
						resolve({ stdout: out });
					},
				);
			}),
	);

	const filePaths = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const map = new Map();

	for (const filePath of filePaths) {
		const fileText = await readFile(filePath, "utf8");
		if (!fileText.includes("DepthsAbilityInfo")) {
			continue;
		}

		const classMatch = fileText.match(
			/public\s+(?:final\s+)?class\s+([A-Za-z0-9_]+)/,
		);
		if (!classMatch) {
			continue;
		}

		const className = classMatch[1];
		const metadata = parseAbilityMetadata(fileText, className);
		if (!metadata) {
			continue;
		}
		map.set(className, metadata);
	}

	return map;
}

function parseCharmEffects(sourceText, abilityMap) {
	const effectRegex =
		/([A-Z0-9_]+)\(\s*(?:"([^"]+)"|([A-Za-z0-9_]+)\.CHARM_COOLDOWN)\s*,\s*([A-Za-z0-9_]+)\.INFO,\s*(true|false),\s*(true|false),\s*([-+]?[0-9]*\.?[0-9]+),\s*([-+]?[0-9]*\.?[0-9]+),\s*new\s+double\[\]\s*\{([^}]*)\}\)/g;
	const capRegex =
		/extraRarityCaps\.put\(([A-Z0-9_]+)\.mEffectName,\s*(\d+)\);/g;
	const rarityCaps = new Map();

	for (const match of sourceText.matchAll(capRegex)) {
		rarityCaps.set(match[1], Number(match[2]));
	}

	const effects = [];
	for (const match of sourceText.matchAll(effectRegex)) {
		const [
			,
			id,
			effectNameRaw,
			cooldownClass,
			abilityClass,
			onlyPositiveRaw,
			isPercentRaw,
			varianceRaw,
			effectCapRaw,
			rarityValuesRaw,
		] = match;
		const abilityMeta = abilityMap.get(abilityClass);
		if (!abilityMeta || !ownableTrees.includes(abilityMeta.tree)) {
			continue;
		}

		const cooldownMeta = abilityMap.get(cooldownClass || abilityClass);
		const effectName =
			effectNameRaw ||
			cooldownMeta?.cooldownEffectName ||
			abilityMeta.cooldownEffectName;

		const rarityValues = parseNumberList(rarityValuesRaw);
		effects.push({
			id,
			effectName,
			abilityClass,
			abilityName: abilityMeta.abilityName,
			tree: abilityMeta.tree,
			singleAbilityCharm: abilityMeta.singleAbilityCharm,
			isOnlyPositive: parseBool(onlyPositiveRaw),
			isPercent: parseBool(isPercentRaw),
			variance: Number(varianceRaw),
			effectCap: Number(effectCapRaw),
			rarityValues,
			maxRarity: rarityCaps.get(id) ?? 5,
		});
	}

	return effects;
}

function toModuleCode({ effects, adjectives, nounItems, nounConcepts }) {
	const payload = {
		ownableTrees,
		treeDisplayNames: {
			DAWNBRINGER: "Dawnbringer",
			EARTHBOUND: "Earthbound",
			FLAMECALLER: "Flamecaller",
			FROSTBORN: "Frostborn",
			SHADOWDANCER: "Shadowdancer",
			STEELSAGE: "Steelsage",
			WINDWALKER: "Windwalker",
		},
		effects,
		adjectives,
		nounItems,
		nounConcepts,
	};

	return `export const ZENITH_DATA = ${JSON.stringify(payload, null, 2)};\n`;
}

async function main() {
	const [effectsText, adjectiveText, nounItemText, nounConceptText] =
		await Promise.all([
			readFile(
				path.join(monumentaRoot, "charmfactory/CharmEffects.java"),
				"utf8",
			),
			readFile(
				path.join(monumentaRoot, "charmfactory/CharmAdjectives.java"),
				"utf8",
			),
			readFile(
				path.join(monumentaRoot, "charmfactory/CharmNounItems.java"),
				"utf8",
			),
			readFile(
				path.join(monumentaRoot, "charmfactory/CharmNounConcepts.java"),
				"utf8",
			),
		]);

	const abilityMap = await collectAbilityInfo();
	const effects = parseCharmEffects(effectsText, abilityMap);
	const adjectives = parseSimpleNamePool(adjectiveText);
	const nounItems = parseNounItems(nounItemText);
	const nounConcepts = parseSimpleNamePool(nounConceptText);

	const outDir = path.join(projectRoot, "src");
	const outPath = path.join(outDir, "zenith-data.js");
	await mkdir(outDir, { recursive: true });
	await writeFile(
		outPath,
		toModuleCode({ effects, adjectives, nounItems, nounConcepts }),
		"utf8",
	);

	process.stdout.write(
		`Wrote ${effects.length} effects to ${path.relative(projectRoot, outPath)}\n`,
	);
}

main().catch((error) => {
	process.stderr.write(`${error.stack || error.message}\n`);
	process.exitCode = 1;
});
