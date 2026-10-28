export const defaultProfiles = {
	codex: {
		model: { provider: "openai", family: "sol" },
		agents: {
			scout: { provider: "openai", family: "luna" },
			worker: { provider: "openai", family: "terra" },
			reviewer: { provider: "anthropic", family: "opus" },
		},
	},
	claude: {
		model: { provider: "anthropic", family: "sonnet" },
		agents: {
			scout: { provider: "anthropic", family: "haiku" },
			worker: { provider: "anthropic", family: "sonnet" },
			reviewer: { provider: "openai", family: "sol" },
		},
	},
};

export function object(value, label) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}

export function mergeProfileDefinitions(value = {}) {
	object(value, "modelProfiles");
	const profiles = object(value.profiles === undefined ? {} : value.profiles, "modelProfiles.profiles");
	return { ...value, profiles: { ...structuredClone(defaultProfiles), ...profiles } };
}

export function matchesSelector(model, selector) {
	object(selector, "Model selector");
	if (typeof selector.provider !== "string" || !selector.provider.trim()
		|| typeof selector.family !== "string" || !/^[a-z][a-z0-9]*$/i.test(selector.family)) {
		throw new Error("Model selectors require a provider and a single-token family");
	}
	return model.provider === selector.provider
		&& model.id.toLowerCase().split(/[-_.\/]+/).includes(selector.family.toLowerCase());
}

export async function resolveProfile(profile, models, choose) {
	object(profile, "Profile");
	const agents = object(profile.agents, "Profile agents");
	for (const role of ["scout", "worker", "reviewer"]) {
		if (!Object.hasOwn(agents, role)) throw new Error(`Profile is missing ${role}`);
	}
	for (const role of Object.keys(agents)) {
		if (role === "parent" || !/^[a-z][a-z0-9_-]*$/i.test(role)) throw new Error(`Invalid profile agent role: ${role}`);
	}
	const selectors = [["parent", profile.model], ...Object.entries(agents)];
	const candidates = selectors.map(([role, selector]) => {
		matchesSelector({ provider: "", id: "" }, selector);
		const matches = [...new Map(models.filter((model) => matchesSelector(model, selector))
			.map((model) => [`${model.provider}/${model.id}`, model])).values()]
			.sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`));
		if (!matches.length) throw new Error(`No scoped model matches ${role}: ${selector.provider}/${selector.family}`);
		return { role, selector, matches };
	});
	const resolved = {};
	const choices = new Map();
	for (const { role, selector, matches } of candidates) {
		const key = `${selector.provider}/${selector.family.toLowerCase()}`;
		let model = choices.get(key);
		if (!model) {
			model = matches.length === 1 ? matches[0] : await choose(role, matches);
			if (!model) throw new Error("Profile selection cancelled; nothing changed");
			if (!matches.includes(model)) throw new Error(`Invalid model selection for ${role}`);
			choices.set(key, model);
		}
		resolved[role] = model;
	}
	return resolved;
}

export function applyProfileSettings(settings, name, resolved, definitions) {
	object(settings, "settings.json");
	const subagents = object(settings.subagents ?? {}, "subagents");
	const overrides = object(subagents.agentOverrides ?? {}, "subagents.agentOverrides");
	const updated = { ...overrides };
	for (const [role, model] of Object.entries(resolved)) {
		if (role === "parent") continue;
		updated[role] = { ...object(overrides[role] ?? {}, `agentOverrides.${role}`), model: `${model.provider}/${model.id}` };
	}
	return {
		...settings,
		defaultProvider: resolved.parent.provider,
		defaultModel: resolved.parent.id,
		modelProfiles: { ...mergeProfileDefinitions(definitions), active: name },
		subagents: { ...subagents, agentOverrides: updated },
	};
}

export function assertProfileScope(settings, resolved, scopedModels) {
	const scope = settings.subagents?.modelScope;
	if (!scope) return;
	const parent = `${resolved.parent.provider}/${resolved.parent.id}`;
	const scoped = new Set(scopedModels.map((model) => `${model.provider}/${model.id}`));
	const matches = (patterns, model) => patterns.some((pattern) => {
		if (pattern === "inherit") return model === parent;
		if (pattern === "scoped") return scoped.size ? scoped.has(model) : model === parent;
		const regex = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
		return new RegExp(`^${regex}$`, "i").test(model);
	});
	for (const [role, model] of Object.entries(resolved)) {
		if (role === "parent") continue;
		const rule = scope.agents?.[role];
		if (!(rule?.enforce ?? scope.enforce)) continue;
		const id = `${model.provider}/${model.id}`;
		if ((scope.allow?.length && !matches(scope.allow, id)) || (rule?.allow?.length && !matches(rule.allow, id))) {
			throw new Error(`Subagent model scope rejects ${role}: ${id}`);
		}
	}
}

export function assertNoProfileConflicts(project, global, resolved) {
	object(project, "Project settings");
	for (const key of ["defaultProvider", "defaultModel"]) {
		if (Object.hasOwn(project, key)) throw new Error(`Project ${key} overrides global profiles; remove it before switching`);
	}
	if (project.modelProfiles !== undefined) throw new Error("Project modelProfiles overrides global profiles; remove it before switching");
	for (const [role] of Object.entries(resolved)) {
		if (role === "parent") continue;
		const local = project.subagents?.agentOverrides?.[role];
		if (local?.model !== undefined || local?.disabled === true) throw new Error(`Project override conflicts with profile role ${role}`);
		for (const settings of [global, project]) {
			if (settings.subagents?.agentOverrides?.[role]?.disabled === true) throw new Error(`Profile role ${role} is disabled`);
			const scoped = settings.subagents?.agentOverridesByProvider?.[resolved.parent.provider]?.[role];
			if (scoped?.model !== undefined || scoped?.disabled === true) throw new Error(`Provider-scoped override conflicts with profile role ${role}`);
		}
	}
}
