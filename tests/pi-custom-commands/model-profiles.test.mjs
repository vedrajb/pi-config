import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyProfileSettings, assertNoProfileConflicts, assertProfileScope, defaultProfiles, matchesSelector, mergeProfileDefinitions, resolveProfile } from "../../pi-custom-commands/model-profiles.mjs";
import { readSettingsSnapshot, restoreProfileSettings, writeProfileSettings } from "../../pi-custom-commands/profile-storage.mjs";

const models = [
	["openai", "gpt-6.1-sol"], ["openai", "gpt-6-luna"], ["openai", "gpt-6.1-terra"],
	["anthropic", "claude-opus-5-5"], ["anthropic", "claude-sonnet-5-5"], ["anthropic", "claude-haiku-5-5"],
].map(([provider, id]) => ({ provider, id }));
const neverChoose = () => { throw new Error("Unexpected ambiguity"); };

test("built-in profiles resolve exact requested provider and role mappings", async () => {
	for (const [name, ids] of Object.entries({
		codex: [models[0], models[1], models[2], models[3]],
		claude: [models[4], models[5], models[4], models[0]],
	})) {
		const resolved = await resolveProfile(defaultProfiles[name], models, neverChoose);
		assert.deepEqual(Object.values(resolved), ids);
	}
});

test("family selectors survive model-version changes without guessing versions", async () => {
	const future = models.map((model) => ({ ...model, id: model.id.replace(/6(?:\.1)?/, "9.3").replace(/5-5/, "8-2") }));
	const resolved = await resolveProfile(defaultProfiles.codex, future, neverChoose);
	assert.equal(resolved.parent.id, "gpt-9.3-sol");
	assert.equal(resolved.reviewer.id, "claude-opus-8-2");
});

test("matching uses exact provider and delimited family tokens", () => {
	const selector = { provider: "openai", family: "sol" };
	assert.equal(matchesSelector({ provider: "openai-codex", id: "gpt-6-sol" }, selector), false);
	for (const id of ["solace", "gpt-solar", "gpt-sol2"]) assert.equal(matchesSelector({ provider: "openai", id }, selector), false);
	for (const id of ["gpt-7-sol", "GPT_7_SOL", "gpt-7-sol-preview"]) assert.equal(matchesSelector({ provider: "openai", id }, selector), true);
});

test("multiple matches ask once per family and never sort-select a version", async () => {
	const newer = { provider: "anthropic", id: "claude-sonnet-9-1" };
	const calls = [];
	const resolved = await resolveProfile(defaultProfiles.claude, [...models, newer], (role, matches) => {
		calls.push(role);
		assert.ok(matches.includes(newer));
		return newer;
	});
	assert.deepEqual(calls, ["parent"]);
	assert.equal(resolved.parent, newer);
	assert.equal(resolved.worker, newer);
});

test("missing scoped families abort before presenting any ambiguity UI", async () => {
	await assert.rejects(resolveProfile(defaultProfiles.codex, [models[0], { ...models[0], id: "gpt-7-sol" }], neverChoose), /No scoped model matches scout/);
});

test("cancelled and invalid choices do not resolve a profile", async () => {
	const ambiguous = [...models, { ...models[0], id: "gpt-7-sol" }];
	await assert.rejects(resolveProfile(defaultProfiles.codex, ambiguous, () => undefined), /cancelled/);
	await assert.rejects(resolveProfile(defaultProfiles.codex, ambiguous, () => ({ provider: "wrong", id: "sol" })), /Invalid model selection/);
});

test("malformed definitions and reserved roles fail validation", async () => {
	for (const config of [null, [], { profiles: [] }, { profiles: null }]) assert.throws(() => mergeProfileDefinitions(config));
	for (const profile of [null, {}, { ...defaultProfiles.codex, agents: {} }, { ...defaultProfiles.codex, model: { provider: "openai", family: "*sol*" } }, { ...defaultProfiles.codex, agents: { ...defaultProfiles.codex.agents, parent: models[0] } }]) {
		await assert.rejects(resolveProfile(profile, models, neverChoose));
	}
});

test("profile defaults merge additively without choosing a profile or mutating inputs", () => {
	const existing = { active: "custom", extra: true, profiles: { codex: { custom: true }, custom: { custom: true } } };
	const merged = mergeProfileDefinitions(existing);
	assert.deepEqual(merged.profiles.codex, existing.profiles.codex);
	assert.deepEqual(merged.profiles.claude, defaultProfiles.claude);
	assert.equal(merged.active, "custom");
	assert.equal(existing.profiles.claude, undefined);
	assert.deepEqual(mergeProfileDefinitions(merged), merged);
	assert.equal(mergeProfileDefinitions().active, undefined);
});

test("application changes only defaults, profile metadata and model fields", async () => {
	const settings = { defaultThinkingLevel: "max", theme: "mine", packages: ["keep"], enabledModels: ["keep"], subagents: { modelScope: { enforce: true }, agentOverrides: { worker: { thinking: "medium", tools: ["read"] }, architect: { disabled: true }, custom: { model: "keep" } } } };
	const original = structuredClone(settings);
	const resolved = await resolveProfile(defaultProfiles.codex, models, neverChoose);
	const updated = applyProfileSettings(settings, "codex", resolved, {});
	assert.equal(updated.defaultProvider, "openai");
	assert.equal(updated.defaultModel, "gpt-6.1-sol");
	assert.equal(updated.defaultThinkingLevel, "max");
	assert.equal(updated.subagents.agentOverrides.worker.model, "openai/gpt-6.1-terra");
	assert.deepEqual(updated.subagents.agentOverrides.worker.tools, ["read"]);
	assert.equal(updated.subagents.agentOverrides.worker.thinking, "medium");
	assert.deepEqual(updated.subagents.agentOverrides.architect, { disabled: true });
	assert.deepEqual(updated.subagents.agentOverrides.custom, { model: "keep" });
	assert.deepEqual(updated.enabledModels, ["keep"]);
	assert.deepEqual(settings, original);
});

test("project and provider-specific overrides cannot silently defeat profiles", async () => {
	const resolved = await resolveProfile(defaultProfiles.codex, models, neverChoose);
	for (const project of [{ defaultModel: "mine" }, { defaultProvider: "mine" }, { modelProfiles: {} }, { subagents: { agentOverrides: { worker: { model: "mine" } } } }]) {
		assert.throws(() => assertNoProfileConflicts(project, {}, resolved), /override/i);
	}
	assert.throws(() => assertNoProfileConflicts({}, { subagents: { agentOverridesByProvider: { openai: { worker: { model: "mine" } } } } }, resolved), /Provider-scoped/);
	assert.throws(() => assertNoProfileConflicts({}, { subagents: { agentOverrides: { worker: { disabled: true } } } }, resolved), /disabled/);
	assert.doesNotThrow(() => assertNoProfileConflicts({ theme: "mine" }, { subagents: { agentOverridesByProvider: { other: { worker: { model: "mine" } } } } }, resolved));
});

test("enforced subagent scopes reject forbidden role assignments", async () => {
	const resolved = await resolveProfile(defaultProfiles.codex, models, neverChoose);
	const settings = { subagents: { modelScope: { enforce: true, allow: ["scoped"], agents: { worker: { allow: ["openai/*-terra"] } } } } };
	assert.doesNotThrow(() => assertProfileScope(settings, resolved, models));
	assert.throws(() => assertProfileScope(settings, resolved, [models[0]]), /scope rejects/);
	assert.throws(() => assertProfileScope({ subagents: { modelScope: { enforce: true, allow: ["inherit"] } } }, resolved, models), /scope rejects/);
	assert.doesNotThrow(() => assertProfileScope({ subagents: { modelScope: { enforce: false, allow: ["nothing"] } } }, resolved, models));
});

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "pi-profile-storage-"));
	const path = join(directory, "settings.json");
	writeFileSync(path, '{"theme":"mine"}\n');
	return { path, snapshot: readSettingsSnapshot(path) };
}

test("settings persistence retains a unique exact backup and supports rollback", () => {
	const { path, snapshot } = fixture();
	const committed = writeProfileSettings(snapshot, { ...snapshot.settings, defaultModel: "new" });
	assert.equal(readFileSync(committed.backup, "utf8"), snapshot.text);
	assert.equal(readSettingsSnapshot(path).settings.theme, "mine");
	restoreProfileSettings(committed, snapshot);
	assert.equal(readFileSync(path, "utf8"), snapshot.text);
	const again = writeProfileSettings(snapshot, { defaultModel: "other" });
	assert.notEqual(again.backup, committed.backup);
	assert.ok(existsSync(committed.backup));
});

test("concurrent settings edits prevent write and rollback clobbering", () => {
	const { path, snapshot } = fixture();
	writeFileSync(path, '{"theme":"concurrent"}');
	assert.throws(() => writeProfileSettings(snapshot, {}), /changed/);
	const fresh = readSettingsSnapshot(path);
	const committed = writeProfileSettings(fresh, { defaultModel: "new" });
	writeFileSync(path, '{"theme":"another edit"}');
	assert.throws(() => restoreProfileSettings(committed, fresh), /changed/);
	assert.equal(readSettingsSnapshot(path).settings.theme, "another edit");
});

test("malformed settings are never overwritten", () => {
	const { path } = fixture();
	writeFileSync(path, "invalid JSON");
	assert.throws(() => readSettingsSnapshot(path));
	assert.equal(readFileSync(path, "utf8"), "invalid JSON");
});
