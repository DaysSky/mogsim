import { ZENITH_DATA } from "./zenith-data.js?v=20260223-1";

const CHARM_BUDGET_PER_POWER = [2, 4, 7, 11, 16];
const CHARM_BUDGET_PER_LEVEL = [2, 3, 4, 5, 6];
const TREE_BUDGET_MODIFIER = 1.35;
const WILDCARD_BUDGET_MODIFIER = 1.8;
const WILDCARD_TREE_CAP_CHANCES = [0, 50, 30, 12, 5, 2, 1];
const DEFAULT_LEVEL = 5;
const MAX_ROLL_ATTEMPTS = 300;

const RARITY_NAMES = {
	1: "Common",
	2: "Uncommon",
	3: "Rare",
	4: "Epic",
	5: "Legendary",
};

const RARITY_COLORS = {
	1: "#9f929c",
	2: "#70bc6d",
	3: "#705eca",
	4: "#cd5eca",
	5: "#e49b20",
};

const MC_COLORS = {
	WHITE: "#ffffff",
	GRAY: "#aaaaaa",
	DARK_GRAY: "#555555",
	RED: "#ff5555",
	CHARM_TITLE: "#ff9cf0",
	STAR: "#fffa75",
	GREEN: "#55ff55",
};

const TREE_CLASS_COLORS = {
	DAWNBRINGER: "#f0b326",
	EARTHBOUND: "#6b3d2d",
	FLAMECALLER: "#f04e21",
	FROSTBORN: "#a3cbe1",
	STEELSAGE: "#929292",
	SHADOWDANCER: "#7948af",
	WINDWALKER: "#c0dea9",
};

const TREE_SHORT_NAMES = {
	DAWNBRINGER: "Da",
	EARTHBOUND: "Ea",
	FLAMECALLER: "Fl",
	FROSTBORN: "Fr",
	STEELSAGE: "St",
	SHADOWDANCER: "Sh",
	WINDWALKER: "Wi",
};

const TREE_ORDER = {
	DAWNBRINGER: 0,
	EARTHBOUND: 1,
	FLAMECALLER: 2,
	FROSTBORN: 3,
	STEELSAGE: 4,
	SHADOWDANCER: 5,
	WINDWALKER: 6,
};

const ACTIONS = [
	{ key: "COMMON", rarity: 1, budget: -5, isNegative: false },
	{ key: "UNCOMMON", rarity: 2, budget: -8, isNegative: false },
	{ key: "RARE", rarity: 3, budget: -11, isNegative: false },
	{ key: "EPIC", rarity: 4, budget: -14, isNegative: false },
	{ key: "LEGENDARY", rarity: 5, budget: -16, isNegative: false },
	{ key: "N_COMMON", rarity: 1, budget: 4, isNegative: true },
	{ key: "N_UNCOMMON", rarity: 2, budget: 7, isNegative: true },
	{ key: "N_RARE", rarity: 3, budget: 10, isNegative: true },
	{ key: "N_EPIC", rarity: 4, budget: 13, isNegative: true },
	{ key: "N_LEGENDARY", rarity: 5, budget: 15, isNegative: true },
];

const ACTION_BY_KEY = new Map(ACTIONS.map((action) => [action.key, action]));

const EFFECTS = ZENITH_DATA.effects;
const EFFECT_ORDER = new Map(
	EFFECTS.map((effect, index) => [effect.id, index]),
);

const form = document.querySelector("#roller-form");
const treeSelect = document.querySelector("#tree");
const result = document.querySelector("#result");
const upgradeButton = document.querySelector("#upgrade-button");
let currentCharm = null;
let currentUpgradePreview = null;
let upgradePreviewActive = false;

for (const treeKey of ZENITH_DATA.ownableTrees) {
	const option = document.createElement("option");
	option.value = treeKey;
	option.textContent = ZENITH_DATA.treeDisplayNames[treeKey];
	treeSelect.append(option);
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	rollAndRender();
});

upgradeButton.addEventListener("click", () => {
	setUpgradePreviewActive(!upgradePreviewActive);
});

function rollAndRender() {
	const { level, forcedTree } = readFormValues();

	for (let i = 0; i < MAX_ROLL_ATTEMPTS; i += 1) {
		const rolled = rollCharm({
			seed: randomPositiveLong(),
			power: randomCharmPower(),
			level,
			forcedTree,
		});
		if (rolled) {
			renderAndStoreCharm(rolled);
			return;
		}
	}

	currentCharm = null;
	currentUpgradePreview = null;
	upgradePreviewActive = false;
	upgradeButton.disabled = true;
	upgradeButton.classList.remove("active");
	renderError("Unable to roll a valid charm after rerolling.");
}

function readFormValues() {
	const formData = new FormData(form);
	const level = Number(formData.get("rarity")) || DEFAULT_LEVEL;
	const forcedTree = String(formData.get("tree") || "") || null;

	return {
		level,
		forcedTree,
	};
}

function rollCharm({ seed, power, level, forcedTree }) {
	if (power < 1 || power > 5 || level < 1 || level > 5) {
		return null;
	}

	const random = new JavaRandom(seed);
	let charmType = random.nextInt(10);

	if (power > 3) {
		charmType = Math.max(charmType + 2, 4);
	}
	if (forcedTree) {
		charmType = Math.min(charmType, 8);
	}

	const baseBudget =
		CHARM_BUDGET_PER_POWER[power - 1] * CHARM_BUDGET_PER_LEVEL[level - 1];
	let budget;
	let typeName;
	let mode;
	let chosenTree = null;
	let chosenAbilityName = null;
	let wildcardTreeCap = null;

	const effects = [];
	const actions = [];
	const rolls = [];
	const activeTrees = new Set();
	const starterAction = {
		key: "STARTER",
		rarity: level,
		budget: 0,
		isNegative: false,
		isStarter: true,
	};

	if (charmType < 4) {
		mode = "ABILITY";
		budget = Math.floor(baseBudget);
		const firstApplied = applyRandomCharmEffect({
			random,
			level,
			action: starterAction,
			effects,
			actions,
			rolls,
			chosenAbilityClass: null,
			chosenTree: forcedTree,
			wildcardTreeCap,
			activeTrees,
			isFirstSingleAbilityCharm: true,
		});
		if (!firstApplied) {
			return null;
		}
		chosenTree = firstApplied.tree;
		chosenAbilityName = firstApplied.abilityName;
		typeName = `${ZENITH_DATA.treeDisplayNames[chosenTree]}, ${chosenAbilityName}`;
	} else if (charmType < 9) {
		mode = "TREE";
		budget = Math.floor(baseBudget * TREE_BUDGET_MODIFIER);
		chosenTree =
			forcedTree ||
			ZENITH_DATA.ownableTrees[random.nextInt(ZENITH_DATA.ownableTrees.length)];
		typeName = ZENITH_DATA.treeDisplayNames[chosenTree];

		const firstApplied = applyRandomCharmEffect({
			random,
			level,
			action: starterAction,
			effects,
			actions,
			rolls,
			chosenAbilityClass: null,
			chosenTree,
			wildcardTreeCap,
			activeTrees,
			isFirstSingleAbilityCharm: false,
		});
		if (!firstApplied) {
			return null;
		}
	} else {
		mode = "WILDCARD";
		budget = Math.floor(baseBudget * WILDCARD_BUDGET_MODIFIER);
		typeName = "Wildcard";

		const capRng = new JavaRandom(seed);
		const roll = capRng.nextInt(100);
		let total = 0;
		let cap = 1;

		while (total <= roll && cap < WILDCARD_TREE_CAP_CHANCES.length) {
			total += WILDCARD_TREE_CAP_CHANCES[cap - 1];
			cap += 1;
		}
		wildcardTreeCap = cap;

		const firstApplied = applyRandomCharmEffect({
			random,
			level,
			action: starterAction,
			effects,
			actions,
			rolls,
			chosenAbilityClass: null,
			chosenTree: null,
			wildcardTreeCap,
			activeTrees,
			isFirstSingleAbilityCharm: false,
		});
		if (!firstApplied) {
			return null;
		}
	}

	const initialBudget = budget;

	while (budget > 0) {
		if (effects.length >= 10) {
			break;
		}

		const shuffledActions = ACTIONS.slice();
		shuffle(shuffledActions, random);
		let selected = false;

		for (const action of shuffledActions) {
			if (action.rarity > level && action.rarity > 2) {
				continue;
			}

			if (action.isNegative) {
				if (mode !== "ABILITY") {
					continue;
				}
				if (actions.some((current) => current.isNegative)) {
					continue;
				}
			}

			if (budget + action.budget < 0) {
				continue;
			}

			const applied = applyRandomCharmEffect({
				random,
				level: action.rarity,
				action,
				effects,
				actions,
				rolls,
				chosenAbilityClass:
					mode === "ABILITY" ? effects[0]?.abilityClass || null : null,
				chosenTree: mode === "TREE" ? chosenTree : null,
				wildcardTreeCap,
				activeTrees,
				isFirstSingleAbilityCharm: false,
			});

			if (!applied) {
				continue;
			}

			budget += action.budget;
			selected = true;
			break;
		}

		if (!selected) {
			break;
		}
	}

	if (level < 5) {
		for (let i = 1; i < actions.length; i += 1) {
			const action = actions[i];
			const newAction = getActionFromInt(level);
			if (
				!action ||
				!newAction ||
				action.isNegative ||
				action.rarity <= level ||
				action.rarity <= 2
			) {
				continue;
			}

			const budgetChange = newAction.budget - action.budget;
			budget += budgetChange;

			if (isValidAtLevel(effects[i], newAction.rarity)) {
				actions[i] = newAction;
			}
		}
	}

	if (effects.length > 0) {
		for (let i = 0; i < 100 && budget > 0; i += 1) {
			const index = i % effects.length;
			const currentAction = actions[index];
			const upgraded = upgradeAction(currentAction);

			if (
				!currentAction ||
				currentAction.isStarter ||
				!upgraded ||
				upgraded.key === currentAction.key
			) {
				continue;
			}
			if (upgraded.rarity > level) {
				continue;
			}

			const budgetChange = upgraded.budget - currentAction.budget;
			if (budget + budgetChange < 0) {
				continue;
			}

			if (
				!isValidAtLevel(effects[index], upgraded.rarity) ||
				!isNotRestrictedAtLevel(
					effects[index],
					upgraded.rarity,
					upgraded.isNegative,
				)
			) {
				continue;
			}

			actions[index] = upgraded;
			budget += budgetChange;
		}
	}

	const sortedIndexes = effects
		.map((_, index) => index)
		.sort(
			(a, b) =>
				EFFECT_ORDER.get(effects[a].id) - EFFECT_ORDER.get(effects[b].id),
		);
	const effectEntries = effects.map((effect, index) => ({
		effect,
		action: actions[index],
		roll: rolls[index],
	}));

	return buildCharmResult({
		seed,
		power,
		level,
		itemName: randomCharmName(random, chosenTree),
		mode,
		typeName,
		chosenAbilityName,
		chosenTree,
		effectEntries,
		sortedIndexes,
		budgetMax: initialBudget,
		budgetUsed: initialBudget - budget,
	});
}

function buildCharmResult({
	seed,
	power,
	level,
	itemName,
	mode,
	typeName,
	chosenAbilityName,
	chosenTree,
	effectEntries,
	sortedIndexes,
	budgetMax,
	budgetUsed,
}) {
	const lineData = sortedIndexes.map((index) => {
		const entry = effectEntries[index];
		return buildEffectLine(entry.effect, entry.action, entry.roll);
	});
	const averageRoll =
		lineData.length > 0
			? lineData.reduce((sum, line) => sum + line.displayRollValue, 0) /
				lineData.length
			: 0;

	return {
		seed: seed.toString(),
		power,
		level,
		rarityName: RARITY_NAMES[level],
		rarityColor: RARITY_COLORS[level],
		itemName,
		mode,
		typeName,
		chosenAbilityName,
		chosenTree,
		classes: getSortedClasses(effectEntries.map((entry) => entry.effect)),
		budgetMax,
		budgetUsed,
		averageRoll,
		effectEntries,
		effects: lineData,
	};
}

function computeBudgetMax(level, power, mode) {
	const base =
		CHARM_BUDGET_PER_POWER[power - 1] * CHARM_BUDGET_PER_LEVEL[level - 1];
	if (mode === "TREE") {
		return Math.floor(base * TREE_BUDGET_MODIFIER);
	}
	if (mode === "WILDCARD") {
		return Math.floor(base * WILDCARD_BUDGET_MODIFIER);
	}
	return Math.floor(base);
}

function buildUpgradePreview(charm) {
	if (!canUpgradeCharm(charm)) {
		return null;
	}

	const level = charm.level + 1;
	const budgetMax = computeBudgetMax(level, charm.power, charm.mode);
	const effectEntries = charm.effectEntries.map((entry, index) => ({
		effect: entry.effect,
		action:
			index === 0
				? {
						...entry.action,
						rarity: level,
					}
				: entry.action,
		roll: entry.roll,
	}));

	let remainingBudget = budgetMax - charm.budgetUsed;
	let upgraded = true;

	while (upgraded) {
		upgraded = false;
		for (let index = 1; index < effectEntries.length; index += 1) {
			const entry = effectEntries[index];
			const nextAction = upgradeAction(entry.action);
			if (!nextAction || nextAction.key === entry.action.key) {
				continue;
			}
			if (nextAction.rarity > level) {
				continue;
			}

			const budgetDelta = nextAction.budget - entry.action.budget;
			if (remainingBudget + budgetDelta < 0) {
				continue;
			}
			if (
				!isValidAtLevel(entry.effect, nextAction.rarity) ||
				!isNotRestrictedAtLevel(
					entry.effect,
					nextAction.rarity,
					nextAction.isNegative,
				)
			) {
				continue;
			}

			effectEntries[index] = {
				...entry,
				action: nextAction,
			};
			remainingBudget += budgetDelta;
			upgraded = true;
		}
	}

	const sortedIndexes = effectEntries
		.map((_, index) => index)
		.sort(
			(a, b) =>
				EFFECT_ORDER.get(effectEntries[a].effect.id) -
				EFFECT_ORDER.get(effectEntries[b].effect.id),
		);

	return buildCharmResult({
		seed: charm.seed,
		power: charm.power,
		level,
		itemName: charm.itemName,
		mode: charm.mode,
		typeName: charm.typeName,
		chosenAbilityName: charm.chosenAbilityName,
		chosenTree: charm.chosenTree,
		effectEntries,
		sortedIndexes,
		budgetMax,
		budgetUsed: budgetMax - remainingBudget,
	});
}

function canUpgradeCharm(charm) {
	return Boolean(charm && charm.level < 5 && charm.effectEntries.length > 0);
}

function applyRandomCharmEffect({
	random,
	level,
	action,
	effects,
	actions,
	rolls,
	chosenAbilityClass,
	chosenTree,
	wildcardTreeCap,
	activeTrees,
	isFirstSingleAbilityCharm,
}) {
	const shuffledEffects = EFFECTS.slice();
	shuffle(shuffledEffects, random);
	let chosenEffect = null;

	for (const effect of shuffledEffects) {
		if (effects.some((entry) => entry.id === effect.id)) {
			continue;
		}
		if (chosenAbilityClass && effect.abilityClass !== chosenAbilityClass) {
			continue;
		}
		if (chosenTree && effect.tree !== chosenTree) {
			continue;
		}
		if (!isValidAtLevel(effect, level)) {
			continue;
		}
		if (!isNotRestrictedAtLevel(effect, level, action.isNegative)) {
			continue;
		}
		if (action.isNegative && effect.isOnlyPositive) {
			continue;
		}
		if (isFirstSingleAbilityCharm && !effect.singleAbilityCharm) {
			continue;
		}

		if (!chosenAbilityClass && !chosenTree && wildcardTreeCap !== null) {
			if (
				!activeTrees.has(effect.tree) &&
				activeTrees.size >= wildcardTreeCap
			) {
				continue;
			}
		}

		chosenEffect = effect;
		break;
	}

	if (!chosenEffect) {
		return null;
	}

	const roll = random.nextDouble();
	effects.push(chosenEffect);
	actions.push(action);
	rolls.push(roll);
	activeTrees.add(chosenEffect.tree);
	return chosenEffect;
}

function buildEffectLine(effect, action, roll) {
	const actionRarity = action.rarity;
	const baseValue = effect.rarityValues[actionRarity - 1];
	let value = baseValue;

	if (effect.variance !== 0) {
		value += effect.variance * (2 * roll - 1);
	}

	if (baseValue >= 5) {
		value = Math.round(value);
	} else {
		value = Math.round(value * 100) / 100;
	}

	if (action.isNegative) {
		value *= -1;
	}

	const valueColor = action.isNegative
		? MC_COLORS.RED
		: RARITY_COLORS[actionRarity];
	const valueText = `${fmtDouble(value)}${effect.isPercent ? "%" : ""}`;
	const { abilityName, statName } = splitEffectName(
		effect.abilityName,
		effect.effectName,
	);
	const displayRollValue =
		baseValue < 0 === action.isNegative ? roll : 1 - roll;
	const rollText = `${fmtDouble(twoDecimal(displayRollValue * 100), false)}%`;

	return {
		modText: valueText,
		valueColor,
		abilityName,
		abilityColor: TREE_CLASS_COLORS[effect.tree] || MC_COLORS.WHITE,
		effectText: statName,
		effectColor: valueColor,
		rollText,
		rollColor: colorRange(displayRollValue),
		displayRollValue,
	};
}

function randomCharmName(random, chosenTree) {
	const adjective = pickName(random, ZENITH_DATA.adjectives, chosenTree);
	const noun = pickName(random, ZENITH_DATA.nounItems, chosenTree);
	const concept = pickName(random, ZENITH_DATA.nounConcepts, chosenTree);
	return `${adjective} ${noun} of ${concept}`;
}

function pickName(random, list, chosenTree) {
	const filtered = list.filter((entry) => {
		if (chosenTree) {
			return entry.tree === null || entry.tree === chosenTree;
		}
		return entry.tree === null;
	});

	if (filtered.length === 0) {
		return list[random.nextInt(list.length)].name;
	}

	return filtered[random.nextInt(filtered.length)].name;
}

function isValidAtLevel(effect, level) {
	return effect.rarityValues[level - 1] !== 0;
}

function isNotRestrictedAtLevel(effect, level, isNegative) {
	if (isNegative) {
		return true;
	}
	return level <= effect.maxRarity;
}

function getActionFromInt(level) {
	switch (level) {
		case 1:
			return ACTION_BY_KEY.get("COMMON");
		case 2:
			return ACTION_BY_KEY.get("UNCOMMON");
		case 3:
			return ACTION_BY_KEY.get("RARE");
		case 4:
			return ACTION_BY_KEY.get("EPIC");
		default:
			return ACTION_BY_KEY.get("LEGENDARY");
	}
}

function upgradeAction(action) {
	const path = {
		N_LEGENDARY: "N_EPIC",
		N_EPIC: "N_RARE",
		N_RARE: "N_UNCOMMON",
		N_UNCOMMON: "N_COMMON",
		N_COMMON: "COMMON",
		COMMON: "UNCOMMON",
		UNCOMMON: "RARE",
		RARE: "EPIC",
		EPIC: "LEGENDARY",
		LEGENDARY: "LEGENDARY",
	};
	return ACTION_BY_KEY.get(path[action.key]);
}

function renderCharm(charm) {
	result.replaceChildren();

	const tooltip = document.createElement("div");
	tooltip.className = "mc-tooltip";

	appendSegmentsLine(
		tooltip,
		[
			{ text: charm.itemName, color: charm.rarityColor },
			{ text: " [", color: MC_COLORS.GRAY },
			{
				text: `${fmtDouble(twoDecimal(charm.averageRoll * 100), false)}%`,
				color: colorRange(charm.averageRoll),
			},
			{ text: "]", color: MC_COLORS.GRAY },
		],
		"item-name",
	);
	appendSegmentsLine(tooltip, [
		{ text: "Architect's Ring : ", color: MC_COLORS.DARK_GRAY },
		{ text: "Zenith Charm", color: MC_COLORS.CHARM_TITLE },
	]);
	appendSegmentsLine(tooltip, [
		{ text: "Charm Power : ", color: MC_COLORS.DARK_GRAY },
		{ text: "★".repeat(charm.power), color: MC_COLORS.STAR },
		{ text: " - ", color: MC_COLORS.DARK_GRAY },
		{ text: charm.rarityName, color: charm.rarityColor },
	]);

	renderBudgetLine(
		tooltip,
		charm,
		upgradePreviewActive ? currentUpgradePreview : null,
	);
	renderTypeLine(tooltip, charm);
	appendLine(tooltip, "", MC_COLORS.WHITE, "spacer");
	renderStatTable(
		tooltip,
		charm,
		upgradePreviewActive ? currentUpgradePreview : null,
	);

	result.append(tooltip);
}

function renderAndStoreCharm(charm) {
	currentCharm = charm;
	currentUpgradePreview = buildUpgradePreview(charm);
	upgradePreviewActive = false;
	upgradeButton.disabled = !canUpgradeCharm(charm);
	upgradeButton.classList.remove("active");
	renderCharm(charm);
}

function setUpgradePreviewActive(active) {
	if (!currentCharm || !currentUpgradePreview || upgradeButton.disabled) {
		upgradePreviewActive = false;
		upgradeButton.classList.remove("active");
		return;
	}

	upgradePreviewActive = active;
	upgradeButton.classList.toggle("active", active);
	renderCharm(currentCharm);
}

function appendLine(tooltip, text, color, className = "") {
	const line = document.createElement("p");
	line.textContent = text;
	line.style.color = color;
	if (className) {
		line.classList.add(className);
	}
	tooltip.append(line);
}

function appendSegmentsLine(tooltip, segments, className = "") {
	const line = document.createElement("p");
	line.className = "line";
	if (className) {
		line.classList.add(className);
	}

	for (const segment of segments) {
		const span = document.createElement("span");
		span.textContent = segment.text;
		span.style.color = segment.color;
		line.append(span);
	}

	tooltip.append(line);
}

function renderBudgetLine(tooltip, charm, preview) {
	const budgetRatio =
		charm.budgetMax > 0 ? charm.budgetUsed / charm.budgetMax : 0;
	const segments = [
		{ text: "Budget : ", color: MC_COLORS.DARK_GRAY },
		{ text: `${charm.budgetUsed}/${charm.budgetMax}`, color: MC_COLORS.GRAY },
		{ text: " [", color: MC_COLORS.GRAY },
		{
			text: `${fmtDouble(twoDecimal(budgetRatio * 100), false)}%`,
			color: colorRange(budgetRatio),
		},
		{ text: "]", color: MC_COLORS.GRAY },
	];

	if (preview) {
		const upgradedBudgetRatio =
			preview.budgetMax > 0 ? preview.budgetUsed / preview.budgetMax : 0;
		segments.push(
			{ text: " -> ", color: MC_COLORS.GRAY },
			{
				text: `${preview.budgetUsed}/${preview.budgetMax}`,
				color: MC_COLORS.GRAY,
			},
			{ text: " [", color: MC_COLORS.GRAY },
			{
				text: `${fmtDouble(twoDecimal(upgradedBudgetRatio * 100), false)}%`,
				color: colorRange(upgradedBudgetRatio),
			},
			{ text: "]", color: MC_COLORS.GRAY },
		);
	}

	appendSegmentsLine(tooltip, segments);
}

function renderTypeLine(tooltip, charm) {
	if (charm.mode === "ABILITY") {
		const treeColor = TREE_CLASS_COLORS[charm.chosenTree] || MC_COLORS.WHITE;
		appendSegmentsLine(tooltip, [
			{ text: "Ability", color: MC_COLORS.GRAY },
			{ text: " - ", color: MC_COLORS.DARK_GRAY },
			{ text: charm.chosenAbilityName ?? "", color: treeColor },
			{ text: " (", color: MC_COLORS.GRAY },
			{
				text: ZENITH_DATA.treeDisplayNames[charm.chosenTree] ?? "",
				color: treeColor,
			},
			{ text: ")", color: MC_COLORS.GRAY },
		]);
		return;
	}

	if (charm.mode === "TREE") {
		const treeColor = TREE_CLASS_COLORS[charm.chosenTree] || MC_COLORS.WHITE;
		appendSegmentsLine(tooltip, [
			{ text: "Treelocked", color: MC_COLORS.GRAY },
			{ text: " - ", color: MC_COLORS.DARK_GRAY },
			{
				text: ZENITH_DATA.treeDisplayNames[charm.chosenTree] ?? "",
				color: treeColor,
			},
		]);
		return;
	}

	const segments = [
		{ text: "Wildcard", color: MC_COLORS.GRAY },
		{ text: " - ", color: MC_COLORS.DARK_GRAY },
	];
	for (let index = 0; index < charm.classes.length; index += 1) {
		const tree = charm.classes[index];
		segments.push({
			text: TREE_SHORT_NAMES[tree] ?? tree.slice(0, 2),
			color: TREE_CLASS_COLORS[tree] || MC_COLORS.WHITE,
		});
		if (index < charm.classes.length - 1) {
			segments.push({ text: ",", color: MC_COLORS.DARK_GRAY });
		}
	}
	appendSegmentsLine(tooltip, segments);
}

function renderStatTable(tooltip, charm, preview) {
	const includeAbility = charm.mode !== "ABILITY";
	const table = document.createElement("div");
	table.className = "stat-table";
	table.style.gridTemplateColumns = includeAbility
		? "max-content max-content max-content max-content"
		: "max-content max-content max-content";

	const headers = includeAbility
		? ["Mod", "Ability", "Effect", "Roll"]
		: ["Mod", "Effect", "Roll"];
	for (const header of headers) {
		const cell = document.createElement("span");
		cell.className = "stat-cell stat-header";
		cell.textContent = header;
		table.append(cell);
	}

	for (let index = 0; index < charm.effects.length; index += 1) {
		const effect = charm.effects[index];
		const upgradedEffect = preview?.effects[index] || null;
		appendModCell(table, effect, upgradedEffect);
		if (includeAbility) {
			appendTableCells(table, effect.abilityName, effect.abilityColor);
		}
		appendTableCells(table, effect.effectText, effect.effectColor);
		appendTableCells(table, effect.rollText, effect.rollColor, "stat-roll");
	}

	tooltip.append(table);
}

function appendModCell(table, effect, upgradedEffect) {
	if (!upgradedEffect || upgradedEffect.modText === effect.modText) {
		appendTableCells(table, effect.modText, effect.valueColor);
		return;
	}

	const span = document.createElement("span");
	span.className = "stat-cell";

	appendInlineSpan(span, effect.modText, effect.valueColor);
	appendInlineSpan(span, " -> ", MC_COLORS.GRAY);
	appendInlineSpan(span, upgradedEffect.modText, upgradedEffect.valueColor);

	table.append(span);
}

function appendTableCells(table, text, color, className = "") {
	const span = document.createElement("span");
	span.className = `stat-cell${className ? ` ${className}` : ""}`;
	span.textContent = text;
	span.style.color = color;
	table.append(span);
}

function appendInlineSpan(parent, text, color) {
	const span = document.createElement("span");
	span.textContent = text;
	span.style.color = color;
	parent.append(span);
}

function getSortedClasses(effects) {
	const unique = Array.from(new Set(effects.map((effect) => effect.tree)));
	unique.sort((a, b) => (TREE_ORDER[a] ?? 99) - (TREE_ORDER[b] ?? 99));
	return unique;
}

function twoDecimal(value) {
	return Math.round(value * 100) / 100;
}

function fmtDouble(value, showPlus = true) {
	const abs = Math.abs(value);
	const body = Number.isInteger(abs) ? String(abs) : String(abs);
	if (value < 0) {
		return `-${body}`;
	}
	if (showPlus) {
		return `+${body}`;
	}
	return body;
}

function colorRange(value) {
	const normalized = Math.min(1, Math.max(0, value));
	const hue = normalized / 3;
	return hsvToHex(hue, 1, 1);
}

function hsvToHex(h, s, v) {
	const i = Math.floor(h * 6);
	const f = h * 6 - i;
	const p = v * (1 - s);
	const q = v * (1 - f * s);
	const t = v * (1 - (1 - f) * s);

	let r;
	let g;
	let b;

	switch (i % 6) {
		case 0:
			r = v;
			g = t;
			b = p;
			break;
		case 1:
			r = q;
			g = v;
			b = p;
			break;
		case 2:
			r = p;
			g = v;
			b = t;
			break;
		case 3:
			r = p;
			g = q;
			b = v;
			break;
		case 4:
			r = t;
			g = p;
			b = v;
			break;
		default:
			r = v;
			g = p;
			b = q;
			break;
	}

	const toHex = (channel) =>
		Math.round(channel * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function renderError(message) {
	result.replaceChildren();
	const error = document.createElement("p");
	error.className = "error";
	error.textContent = message;
	result.append(error);
}

function splitEffectName(abilityName, effectName) {
	if (effectName.startsWith(`${abilityName} `)) {
		return {
			abilityName,
			statName: effectName.slice(abilityName.length + 1),
		};
	}

	return {
		abilityName,
		statName: effectName,
	};
}

function randomPositiveLong() {
	const bytes = crypto.getRandomValues(new Uint32Array(2));
	const value = (BigInt(bytes[0]) << 32n) | BigInt(bytes[1]);
	return value & 0x7fffffffffffffffn;
}

function randomCharmPower() {
	const value = crypto.getRandomValues(new Uint32Array(1))[0];
	return (value % 5) + 1;
}

function shuffle(list, random) {
	for (let i = list.length; i > 1; i -= 1) {
		const j = random.nextInt(i);
		[list[i - 1], list[j]] = [list[j], list[i - 1]];
	}
}

class JavaRandom {
	constructor(seed) {
		this.mask = (1n << 48n) - 1n;
		this.multiplier = 0x5deece66dn;
		this.addend = 0xbn;
		this.seed = 0n;
		this.setSeed(seed);
	}

	setSeed(seed) {
		this.seed = (BigInt(seed) ^ this.multiplier) & this.mask;
	}

	next(bits) {
		this.seed = (this.seed * this.multiplier + this.addend) & this.mask;
		return Number(this.seed >> (48n - BigInt(bits)));
	}

	nextInt(bound) {
		if (bound <= 0) {
			throw new Error("bound must be positive");
		}

		if ((bound & -bound) === bound) {
			return Math.floor((bound * this.next(31)) / 2 ** 31);
		}

		let bits;
		let value;
		do {
			bits = this.next(31);
			value = bits % bound;
		} while (bits - value + (bound - 1) < 0);

		return value;
	}

	nextDouble() {
		const high = this.next(26);
		const low = this.next(27);
		return (high * 2 ** 27 + low) / 2 ** 53;
	}
}
