import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { backupUserConfig, copyUserConfig, installPackages, loadConfig, mergeInstructions, mergeSettings, migrateUserConfig, resolveSource } from "./install.mjs";

const repoRoot = dirname(fileURLToPath(import.meta.url));

function tempDir() {
	return mkdtempSync(join(tmpdir(), "pi-install-test-"));
}

test("install.config.json installs pi-subagents and removes pi-open-agents", () => {
	const config = loadConfig(join(repoRoot, "install.config.json"));
	assert.deepEqual(config.packages, ["./pi-custom-commands", "./pi-guardrails", "npm:pi-subagents"]);
	assert.deepEqual(config.removePackages, ["npm:pi-open-agents"]);
});

test("loadConfig rejects missing or invalid packages", () => {
	const dir = tempDir();
	for (const content of ["{}", '{"packages":"x"}', '{"packages":[""]}', '{"packages":[1]}']) {
		const file = join(dir, "config.json");
		writeFileSync(file, content);
		assert.throws(() => loadConfig(file), /"packages" must be an array/);
	}
});

test("resolveSource resolves local paths and passes remote sources through", () => {
	const dir = tempDir();
	mkdirSync(join(dir, "pkg"));
	assert.equal(resolveSource("./pkg", dir), resolve(dir, "pkg"));
	assert.equal(resolveSource("npm:pi-subagents", dir), "npm:pi-subagents");
	assert.equal(resolveSource("https://example.com/repo.git", dir), "https://example.com/repo.git");
	assert.throws(() => resolveSource("./missing", dir), /Package path not found/);
});

test("installPackages installs every package and updates only remote ones", () => {
	const dir = tempDir();
	mkdirSync(join(dir, "a"));
	const ran = [];
	installPackages(
		{ packages: ["./a", "npm:b"] },
		{ baseDir: dir, run: (s) => ran.push(["install", s]), update: (s) => ran.push(["update", s]), log: () => {} },
	);
	assert.deepEqual(ran, [
		["install", resolve(dir, "a")],
		["install", "npm:b"],
		["update", "npm:b"],
	]);
});

test("installPackages validates all paths before installing anything", () => {
	const dir = tempDir();
	mkdirSync(join(dir, "a"));
	const ran = [];
	assert.throws(
		() => installPackages({ packages: ["./a", "./missing"] }, { baseDir: dir, run: (s) => ran.push(s), log: () => {} }),
		/Package path not found/,
	);
	assert.deepEqual(ran, []);
});

test("dry run logs commands without running them", () => {
	const dir = tempDir();
	mkdirSync(join(dir, "a"));
	const ran = [];
	const logs = [];
	installPackages(
		{ packages: ["./a", "npm:b"] },
		{ baseDir: dir, dryRun: true, run: (s) => ran.push(s), update: (s) => ran.push(s), log: (m) => logs.push(m) },
	);
	assert.deepEqual(ran, []);
	assert.deepEqual(logs, [
		`[dry-run] pi install ${resolve(dir, "a")}`,
		"[dry-run] pi install npm:b",
		"[dry-run] pi update npm:b",
	]);
});

function userConfigFixture() {
	const sourceDir = tempDir();
	const targetDir = join(tempDir(), "agent");
	mkdirSync(join(sourceDir, "agents", "sub"), { recursive: true });
	writeFileSync(join(sourceDir, "agents", "a.md"), "A");
	writeFileSync(join(sourceDir, "agents", "sub", "b.md"), "B");
	writeFileSync(join(sourceDir, "AGENTS.md"), "RULES");
	writeFileSync(join(sourceDir, "settings.json"), "{}");
	return { sourceDir, targetDir };
}

test("copyUserConfig copies agents folder recursively and AGENTS.md, overwriting and keeping extras", () => {
	const { sourceDir, targetDir } = userConfigFixture();
	mkdirSync(join(targetDir, "agents"), { recursive: true });
	writeFileSync(join(targetDir, "agents", "a.md"), "old");
	writeFileSync(join(targetDir, "agents", "extra.md"), "keep");
	copyUserConfig({ sourceDir, targetDir, log: () => {} });
	assert.equal(readFileSync(join(targetDir, "agents", "a.md"), "utf8"), "A");
	assert.equal(readFileSync(join(targetDir, "agents", "sub", "b.md"), "utf8"), "B");
	assert.equal(readFileSync(join(targetDir, "agents", "extra.md"), "utf8"), "keep");
	assert.equal(readFileSync(join(targetDir, "AGENTS.md"), "utf8"), "RULES");
});

test("copyUserConfig dry run logs without copying", () => {
	const { sourceDir, targetDir } = userConfigFixture();
	const logs = [];
	copyUserConfig({ sourceDir, targetDir, dryRun: true, log: (m) => logs.push(m) });
	assert.equal(existsSync(targetDir), false);
	assert.deepEqual(logs, [
		`[dry-run] copy ${resolve(sourceDir, "agents")} -> ${resolve(targetDir, "agents")}`,
		`[dry-run] copy ${resolve(sourceDir, "AGENTS.md")} -> ${resolve(targetDir, "AGENTS.md")}`,
	]);
});

test("copyUserConfig does not copy settings.json", () => {
	const { sourceDir, targetDir } = userConfigFixture();
	const copied = [];
	copyUserConfig({ sourceDir, targetDir, log: () => {}, copy: (src) => copied.push(src) });
	assert.deepEqual(copied, [resolve(sourceDir, "agents"), resolve(sourceDir, "AGENTS.md")]);
	copyUserConfig({ sourceDir, targetDir, log: () => {} });
	assert.equal(existsSync(join(targetDir, "settings.json")), false);
});

test("mergeInstructions replaces workflow sections and preserves unrelated user instructions", () => {
	const existing = "# Rules\n\n## Delegation\nOld worker rule\n\n## Coding Guidelines\nKeep my rules.\n";
	const incoming = "# Rules\n\n## Delegation\nNew scout rule\n\n## Complex / Architect Workflow\nUse plan.\n\n## Plan mode\nRead-only.\n\n## Coding Guidelines\nDifferent rules.\n";
	const merged = mergeInstructions(existing, incoming);
	assert.match(merged, /New scout rule/);
	assert.doesNotMatch(merged, /Old worker rule|Different rules/);
	assert.match(merged, /Keep my rules/);
	assert.match(merged, /Complex \/ Architect Workflow/);
	assert.equal(mergeInstructions(merged, incoming), merged);
});

test("settings merge preserves models, packages, and unrelated subagent overrides", () => {
	const existing = { defaultModel: "mine", packages: ["npm:unrelated"], subagents: { agentOverrides: { scout: { model: "mine" }, architect: { model: "legacy" } }, defaultModel: "existing" } };
	const merged = mergeSettings(existing);
	assert.equal(merged.defaultModel, "mine");
	assert.deepEqual(merged.packages, existing.packages);
	assert.deepEqual(merged.subagents.agentOverrides.scout, { model: "mine" });
	assert.deepEqual(merged.subagents.agentOverrides.architect, { model: "legacy", disabled: true });
	assert.equal(merged.subagents.defaultModel, "existing");
	assert.equal(existing.subagents.agentOverrides.architect.disabled, undefined);
	for (const value of [null, [], { subagents: [] }, { subagents: { agentOverrides: "bad" } }]) assert.throws(() => mergeSettings(value));
});

test("backup retains settings and agents and never replaces a previous backup", () => {
	const { sourceDir } = userConfigFixture();
	const first = backupUserConfig({ targetDir: sourceDir, log: () => {} });
	writeFileSync(join(sourceDir, "settings.json"), '{"changed":true}');
	const second = backupUserConfig({ targetDir: sourceDir, log: () => {} });
	assert.notEqual(first, second);
	assert.equal(readFileSync(join(first, "settings.json"), "utf8"), "{}");
	assert.equal(readFileSync(join(second, "settings.json"), "utf8"), '{"changed":true}');
	assert.equal(readFileSync(join(first, "agents", "sub", "b.md"), "utf8"), "B");
});

test("migration backs up before installation and removes the old package after deployment", () => {
	const { sourceDir, targetDir } = userConfigFixture();
	mkdirSync(targetDir);
	writeFileSync(join(targetDir, "settings.json"), '{"defaultModel":"mine","packages":["npm:pi-open-agents","npm:other"]}');
	writeFileSync(join(targetDir, "AGENTS.md"), "# My instructions\n\n## Coding Guidelines\nKeep these.\n");
	const actions = [];
	const backupDir = migrateUserConfig({ packages: ["npm:pi-subagents"], removePackages: ["npm:pi-open-agents"] }, {
		sourceDir, targetDir, baseDir: sourceDir, log: () => {},
		run: (source) => {
			assert.ok(existsSync(join(targetDir, "backup-open-agents")));
			const settings = JSON.parse(readFileSync(join(targetDir, "settings.json"), "utf8"));
			settings.packages.push(source);
			writeFileSync(join(targetDir, "settings.json"), JSON.stringify(settings));
			actions.push("install");
		},
		update: () => actions.push("update"),
		remove: (source) => {
			assert.equal(readFileSync(join(targetDir, "agents", "a.md"), "utf8"), "A");
			const settings = JSON.parse(readFileSync(join(targetDir, "settings.json"), "utf8"));
			assert.equal(settings.subagents.agentOverrides.architect.disabled, true);
			settings.packages = settings.packages.filter((entry) => entry !== source);
			writeFileSync(join(targetDir, "settings.json"), JSON.stringify(settings));
			actions.push("remove");
		},
	});
	assert.deepEqual(actions, ["install", "update", "remove"]);
	const settings = JSON.parse(readFileSync(join(targetDir, "settings.json"), "utf8"));
	assert.equal(settings.defaultModel, "mine");
	assert.deepEqual(settings.packages, ["npm:other", "npm:pi-subagents"]);
	assert.match(readFileSync(join(targetDir, "AGENTS.md"), "utf8"), /Keep these/);
	assert.match(readFileSync(join(backupDir, "settings.json"), "utf8"), /pi-open-agents/);
});

test("migration dry run writes nothing and calls no package operations", () => {
	const { sourceDir, targetDir } = userConfigFixture();
	const actions = [];
	const logs = [];
	migrateUserConfig({ packages: ["npm:pi-subagents"], removePackages: ["npm:pi-open-agents"] }, {
		sourceDir, targetDir, baseDir: sourceDir, dryRun: true, log: (line) => logs.push(line),
		run: () => actions.push("install"), update: () => actions.push("update"), remove: () => actions.push("remove"),
	});
	assert.equal(existsSync(targetDir), false);
	assert.deepEqual(actions, []);
	assert.ok(logs.some((line) => line === "[dry-run] pi uninstall npm:pi-open-agents"));
});

test("installation failure preserves original configuration and does not remove the old package", () => {
	const { sourceDir, targetDir } = userConfigFixture();
	mkdirSync(targetDir);
	writeFileSync(join(targetDir, "settings.json"), "{}");
	let removed = false;
	assert.throws(() => migrateUserConfig({ packages: ["npm:pi-subagents"], removePackages: ["npm:pi-open-agents"] }, {
		sourceDir, targetDir, baseDir: sourceDir, log: () => {},
		run: () => { throw new Error("installation failed"); }, remove: () => { removed = true; },
	}), /installation failed/);
	assert.equal(readFileSync(join(targetDir, "settings.json"), "utf8"), "{}");
	assert.equal(existsSync(join(targetDir, "agents")), false);
	assert.equal(removed, false);
});

test("migration skips uninstall when the old package is already absent", () => {
	const { sourceDir, targetDir } = userConfigFixture();
	let removed = false;
	const logs = [];
	migrateUserConfig({ packages: [], removePackages: ["npm:pi-open-agents"] }, {
		sourceDir, targetDir, baseDir: sourceDir, log: (line) => logs.push(line),
		remove: () => { removed = true; },
	});
	assert.equal(removed, false);
	assert.ok(logs.includes("skip uninstall npm:pi-open-agents (not registered)"));
});

test("deployment failure never uninstalls the old package", () => {
	const { sourceDir, targetDir } = userConfigFixture();
	mkdirSync(join(targetDir, "AGENTS.md"), { recursive: true });
	writeFileSync(join(targetDir, "settings.json"), '{"packages":["npm:pi-open-agents"]}');
	let removed = false;
	assert.throws(() => migrateUserConfig({ packages: [], removePackages: ["npm:pi-open-agents"] }, {
		sourceDir, targetDir, baseDir: sourceDir, log: () => {},
		remove: () => { removed = true; },
	}));
	assert.equal(removed, false);
	assert.deepEqual(JSON.parse(readFileSync(join(targetDir, "settings.json"), "utf8")).packages, ["npm:pi-open-agents"]);
});

test("invalid settings fail preflight before package installation or backup", () => {
	const { sourceDir, targetDir } = userConfigFixture();
	mkdirSync(targetDir);
	writeFileSync(join(targetDir, "settings.json"), "invalid JSON");
	let installed = false;
	assert.throws(() => migrateUserConfig({ packages: ["npm:pi-subagents"] }, {
		sourceDir, targetDir, baseDir: sourceDir, log: () => {}, run: () => { installed = true; },
	}));
	assert.equal(installed, false);
	assert.equal(existsSync(join(targetDir, "backup-open-agents")), false);
});

test("uninstall handles version-pinned package objects without touching other packages", () => {
	const { sourceDir, targetDir } = userConfigFixture();
	mkdirSync(targetDir);
	writeFileSync(join(targetDir, "settings.json"), JSON.stringify({ packages: [{ source: "npm:pi-open-agents@1.2.3", extensions: [] }, "npm:other"] }));
	const removed = [];
	migrateUserConfig({ packages: [], removePackages: ["npm:pi-open-agents"] }, {
		sourceDir, targetDir, baseDir: sourceDir, log: () => {}, remove: (source) => removed.push(source),
	});
	assert.deepEqual(removed, ["npm:pi-open-agents@1.2.3"]);
});
