import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { copyUserConfig, installPackages, loadConfig, resolveSource } from "./install.mjs";

const repoRoot = dirname(fileURLToPath(import.meta.url));

function tempDir() {
	return mkdtempSync(join(tmpdir(), "pi-install-test-"));
}

test("install.config.json lists pi-custom-commands, pi-guardrails and pi-open-agents", () => {
	const config = loadConfig(join(repoRoot, "install.config.json"));
	assert.deepEqual(config.packages, ["./pi-custom-commands", "./pi-guardrails", "npm:pi-open-agents"]);
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
	assert.equal(resolveSource("npm:pi-open-agents", dir), "npm:pi-open-agents");
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
