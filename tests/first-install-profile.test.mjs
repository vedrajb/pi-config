import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateUserConfig } from "../install.mjs";

function fixture(existing) {
	const root = mkdtempSync(join(tmpdir(), "pi-first-profile-"));
	const sourceDir = join(root, "source");
	const targetDir = join(root, "agent");
	mkdirSync(join(sourceDir, "agents"), { recursive: true });
	writeFileSync(join(sourceDir, "agents", "scout.md"), "Scout");
	writeFileSync(join(sourceDir, "AGENTS.md"), "# Rules\n");
	if (existing !== undefined) {
		mkdirSync(targetDir);
		writeFileSync(join(targetDir, "settings.json"), JSON.stringify(existing));
	}
	const logs = [];
	const options = { sourceDir, targetDir, baseDir: root, log: (message) => logs.push(message) };
	return { targetDir, options, logs, settings: () => JSON.parse(readFileSync(join(targetDir, "settings.json"), "utf8")) };
}

test("fresh installation queues Claude without fabricating an active profile or concrete model IDs", () => {
	const f = fixture();
	migrateUserConfig({ packages: [] }, f.options);
	const settings = f.settings();
	assert.equal(settings.modelProfiles.pendingDefault, "claude");
	assert.equal(settings.modelProfiles.active, undefined);
	assert.equal(settings.defaultProvider, undefined);
	assert.equal(settings.defaultModel, undefined);
	assert.equal(settings.subagents.agentOverrides.worker, undefined);
	assert.ok(f.logs.some((message) => message.includes("queue first-install claude")));
	migrateUserConfig({ packages: [] }, f.options);
	assert.deepEqual(f.settings(), settings);
});

test("any existing settings file preserves defaults and does not queue automatic activation", () => {
	for (const existing of [
		{},
		{ defaultProvider: "mine", defaultModel: "existing", defaultThinkingLevel: "max" },
		{ modelProfiles: { active: "codex" }, defaultModel: "codex-model", subagents: { agentOverrides: { worker: { model: "keep" } } } },
		{ modelProfiles: { active: "custom", profiles: { custom: { model: "keep" } } } },
	]) {
		const f = fixture(existing);
		migrateUserConfig({ packages: [] }, f.options);
		const settings = f.settings();
		assert.equal(settings.modelProfiles.pendingDefault, undefined);
		assert.equal(settings.modelProfiles.active, existing.modelProfiles?.active);
		assert.equal(settings.defaultModel, existing.defaultModel);
		assert.equal(settings.defaultProvider, existing.defaultProvider);
		assert.equal(settings.defaultThinkingLevel, existing.defaultThinkingLevel);
		if (existing.subagents) assert.deepEqual(settings.subagents.agentOverrides.worker, existing.subagents.agentOverrides.worker);
		assert.equal(f.logs.some((message) => message.includes("queue first-install")), false);
	}
});

test("first-install detection happens before package installation creates settings", () => {
	const f = fixture();
	migrateUserConfig({ packages: ["npm:example"] }, {
		...f.options,
		run: () => {
			mkdirSync(f.targetDir);
			writeFileSync(join(f.targetDir, "settings.json"), JSON.stringify({ packages: ["npm:example"], theme: "keep" }));
		},
		update: () => {},
	});
	assert.equal(f.settings().modelProfiles.pendingDefault, "claude");
	assert.equal(f.settings().theme, "keep");
	assert.deepEqual(f.settings().packages, ["npm:example"]);
});

test("a profile selected during installation is not replaced by the first-install default", () => {
	const f = fixture();
	migrateUserConfig({ packages: ["npm:example"] }, {
		...f.options,
		run: () => {
			mkdirSync(f.targetDir);
			writeFileSync(join(f.targetDir, "settings.json"), JSON.stringify({ modelProfiles: { active: "codex" } }));
		},
		update: () => {},
	});
	assert.equal(f.settings().modelProfiles.active, "codex");
	assert.equal(f.settings().modelProfiles.pendingDefault, undefined);
});

test("first-install dry run previews the default without creating settings", () => {
	const f = fixture();
	migrateUserConfig({ packages: [] }, { ...f.options, dryRun: true });
	assert.equal(existsSync(f.targetDir), false);
	assert.ok(f.logs.some((message) => message.startsWith("[dry-run] queue first-install claude")));
});
