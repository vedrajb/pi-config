import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const hook = fileURLToPath(new URL("../.githooks/pre-commit", import.meta.url));
const setup = fileURLToPath(new URL("../.githooks/setup.mjs", import.meta.url));
const path = ".pi.user/settings.json";

function fixture({ initial = false, settings = { deviceId: "original-device", theme: "dark" } } = {}) {
	const root = mkdtempSync(join(tmpdir(), "pi-device-hook-"));
	const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, "empty-git-config") };
	for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"]) delete env[key];
	writeFileSync(env.GIT_CONFIG_GLOBAL, "");
	const git = (...args) => {
		const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr || result.error?.message);
		return result.stdout;
	};
	const write = (value) => writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
	git("init", "--quiet");
	git("config", "user.name", "Hook Test");
	git("config", "user.email", "hook-test@example.invalid");
	mkdirSync(join(root, ".pi.user"));
	writeFileSync(join(root, "README.md"), "Test repository\n");
	if (settings !== null) write(settings);
	git("add", "README.md");
	if (settings !== null) git("add", path);
	if (!initial) git("commit", "--quiet", "-m", "test: seed device id");
	return {
		root, env, git, write,
		stage(value) { write(value); git("add", path); },
		check(extraEnv = {}) { return spawnSync(process.execPath, [hook], { cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8" }); },
		install() {
			mkdirSync(join(root, ".githooks"));
			writeFileSync(join(root, ".githooks/pre-commit"), readFileSync(hook));
			writeFileSync(join(root, ".githooks/setup.mjs"), readFileSync(setup));
		},
		setup() { return spawnSync(process.execPath, [join(root, ".githooks/setup.mjs")], { cwd: root, env, encoding: "utf8" }); },
	};
}

function allowed(result) {
	assert.equal(result.status, 0, result.stderr || result.error?.message);
}

function blocked(result) {
	assert.equal(result.status, 1, result.stderr || result.error?.message);
	assert.match(result.stderr, /changes or removes deviceId/);
}

test("hook allows unrelated staged files and unchanged settings", () => {
	const f = fixture();
	allowed(f.check());
	writeFileSync(join(f.root, "README.md"), "Unrelated staged edit\n");
	f.git("add", "README.md");
	f.write({ deviceId: "working-tree-only-change" });
	allowed(f.check());
});

test("hook allows other settings changes, formatting and property reordering", () => {
	const f = fixture();
	f.stage('{\n  "theme": "light",\n  "other": true,\n  "deviceId": "original-device"\n}\n');
	allowed(f.check());
});

test("hook blocks a staged UUID change even when the working tree restores the original", () => {
	const f = fixture();
	f.stage({ deviceId: "different-device", theme: "dark" });
	f.write({ deviceId: "original-device", theme: "dark" });
	blocked(f.check());
	assert.equal(JSON.parse(f.git("show", `:${path}`)).deviceId, "different-device");
	assert.equal(JSON.parse(readFileSync(join(f.root, path), "utf8")).deviceId, "original-device");
});

test("hook ignores an unstaged UUID change when the staged UUID is unchanged", () => {
	const f = fixture();
	f.stage({ deviceId: "original-device", theme: "light" });
	f.write({ deviceId: "unstaged-device", theme: "light" });
	allowed(f.check());
});

test("hook blocks removal, nulling, and type changes of the committed UUID", () => {
	for (const settings of [{ theme: "light" }, { deviceId: null }, { deviceId: 42 }]) {
		const f = fixture();
		f.stage(settings);
		blocked(f.check());
	}
});

test("deleting the settings file cannot bypass UUID protection", () => {
	const f = fixture();
	f.git("update-index", "--force-remove", "--", path);
	blocked(f.check());
	assert.equal(existsSync(join(f.root, path)), true);
});

test("hook allows initial commits and the first addition of the settings file", () => {
	const initial = fixture({ initial: true });
	allowed(initial.check());
	const added = fixture({ settings: null });
	added.stage({ deviceId: "first-device" });
	allowed(added.check());
});

test("adding a UUID to an existing settings file counts as a UUID change", () => {
	const f = fixture({ settings: { theme: "dark" } });
	f.stage({ theme: "dark", deviceId: "new-device" });
	blocked(f.check());
});

test("settings without a UUID allow unrelated edits", () => {
	const f = fixture({ settings: { theme: "dark" } });
	f.stage({ theme: "light" });
	allowed(f.check());
});

test("hook fails closed on malformed staged JSON and non-object settings", () => {
	for (const value of ["{invalid", "null", "[]", "42"]) {
		const f = fixture();
		f.stage(value);
		const result = f.check();
		assert.equal(result.status, 1);
		assert.match(result.stderr, /invalid JSON|must contain a JSON object/);
	}
});

test("hook honors Git's alternate index rather than assuming .git/index", () => {
	const f = fixture();
	const alternate = { ...f.env, GIT_INDEX_FILE: join(f.root, "alternate-index") };
	for (const args of [["read-tree", "HEAD"], ["add", path]]) {
		if (args[0] === "add") f.write({ deviceId: "alternate-device" });
		const result = spawnSync("git", args, { cwd: f.root, env: alternate, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	}
	blocked(f.check({ GIT_INDEX_FILE: alternate.GIT_INDEX_FILE }));
	allowed(f.check());
});

test("hook refuses to succeed outside a Git repository", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-hook-not-repo-"));
	const result = spawnSync(process.execPath, [hook], { cwd: root, encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Cannot check staged deviceId/);
});

test("setup is local and idempotent, and Git actually invokes the Node pre-commit hook", () => {
	const f = fixture();
	f.install();
	allowed(f.setup());
	allowed(f.setup());
	assert.equal(f.git("config", "--local", "--get", "core.hooksPath").trim(), ".githooks");
	assert.equal(readFileSync(f.env.GIT_CONFIG_GLOBAL, "utf8"), "");
	f.stage({ deviceId: "blocked-device" });
	const result = spawnSync("git", ["commit", "--quiet", "-m", "test: reject device id change"], { cwd: f.root, env: f.env, encoding: "utf8" });
	blocked(result);
	f.stage({ deviceId: "original-device", theme: "light" });
	f.git("commit", "--quiet", "-m", "test: allow other settings changes");
	assert.equal(JSON.parse(f.git("show", `HEAD:${path}`)).theme, "light");
});

test("setup refuses to replace a custom hooksPath", () => {
	const f = fixture();
	f.install();
	f.git("config", "core.hooksPath", "custom-hooks");
	const result = f.setup();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /already configured/);
	assert.equal(f.git("config", "--get", "core.hooksPath").trim(), "custom-hooks");
});

test("setup refuses to hide an existing default pre-commit hook", () => {
	const f = fixture();
	f.install();
	const existing = join(f.root, ".git/hooks/pre-commit");
	writeFileSync(existing, "#!/bin/sh\nexit 0\n");
	const result = f.setup();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /pre-commit hook already exists/);
	assert.equal(readFileSync(existing, "utf8"), "#!/bin/sh\nexit 0\n");
	const configured = spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: f.root, env: f.env, encoding: "utf8" });
	assert.equal(configured.status, 1);
});
