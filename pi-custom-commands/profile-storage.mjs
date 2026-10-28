import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { object } from "./model-profiles.mjs";

export function readSettingsSnapshot(path) {
	const text = existsSync(path) ? readFileSync(path, "utf8") : null;
	return { path, text, settings: object(text === null ? {} : JSON.parse(text), path) };
}

export function assertSnapshot(snapshot) {
	const current = existsSync(snapshot.path) ? readFileSync(snapshot.path, "utf8") : null;
	if (current !== snapshot.text) throw new Error(`${snapshot.path} changed during profile selection; retry`);
}

export function writeProfileSettings(snapshot, settings) {
	assertSnapshot(snapshot);
	const directory = dirname(snapshot.path);
	const id = randomUUID();
	mkdirSync(directory, { recursive: true });
	const backups = join(directory, "profile-backups");
	mkdirSync(backups, { recursive: true });
	const backup = join(backups, `${Date.now()}-${id}.json`);
	writeFileSync(backup, snapshot.text ?? "{}\n", { flag: "wx", mode: 0o600 });
	const text = `${JSON.stringify(settings, null, 2)}\n`;
	const temporary = join(directory, `.profile-${id}.tmp`);
	writeFileSync(temporary, text, { flag: "wx", mode: snapshot.text === null ? 0o600 : statSync(snapshot.path).mode & 0o777 });
	assertSnapshot(snapshot);
	renameSync(temporary, snapshot.path);
	return { backup, snapshot: { path: snapshot.path, text, settings } };
}

export function restoreProfileSettings(committed, original) {
	assertSnapshot(committed.snapshot);
	const temporary = join(dirname(original.path), `.profile-restore-${randomUUID()}.tmp`);
	writeFileSync(temporary, original.text ?? "{}\n", { flag: "wx", mode: 0o600 });
	renameSync(temporary, original.path);
}
