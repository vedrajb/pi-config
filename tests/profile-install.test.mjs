import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeSettings } from "../install.mjs";
import { defaultProfiles } from "../pi-custom-commands/model-profiles.mjs";

test("installer adds profile selectors without activating or changing existing defaults", () => {
	const existing = { defaultProvider: "mine", defaultModel: "existing", defaultThinkingLevel: "max", subagents: { agentOverrides: { worker: { model: "keep" }, architect: { disabled: true } } } };
	const original = structuredClone(existing);
	const merged = mergeSettings(existing);
	assert.deepEqual(merged.modelProfiles.profiles, defaultProfiles);
	assert.equal(merged.modelProfiles.active, undefined);
	assert.equal(merged.defaultProvider, "mine");
	assert.equal(merged.defaultModel, "existing");
	assert.equal(merged.defaultThinkingLevel, "max");
	assert.deepEqual(merged.subagents, existing.subagents);
	assert.deepEqual(existing, original);
	assert.deepEqual(mergeSettings(merged), merged);
});

test("installer retains custom and edited built-in profile definitions", () => {
	const existing = { modelProfiles: { active: "custom", profiles: { codex: { custom: true }, custom: { custom: true } } } };
	const merged = mergeSettings(existing);
	assert.equal(merged.modelProfiles.active, "custom");
	assert.deepEqual(merged.modelProfiles.profiles.codex, { custom: true });
	assert.deepEqual(merged.modelProfiles.profiles.custom, { custom: true });
	assert.deepEqual(merged.modelProfiles.profiles.claude, defaultProfiles.claude);
	for (const modelProfiles of [null, [], { profiles: [] }, { profiles: null }]) assert.throws(() => mergeSettings({ modelProfiles }));
});

test("template profiles match command defaults and package exposes the profile command", () => {
	const settings = JSON.parse(readFileSync(new URL("../.pi.user/settings.json", import.meta.url), "utf8"));
	assert.deepEqual(settings.modelProfiles.profiles, defaultProfiles);
	const manifest = JSON.parse(readFileSync(new URL("../pi-custom-commands/package.json", import.meta.url), "utf8"));
	assert.ok(manifest.pi.extensions.includes("./profiles.ts"));
});
