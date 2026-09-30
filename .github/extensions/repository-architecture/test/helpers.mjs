import { cp, mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ROOT = path.join(TEST_DIRECTORY, "fixtures", "repository");
export const GENERIC_FIXTURE_ROOT = path.join(TEST_DIRECTORY, "fixtures", "generic-repository");

export async function createFixtureRepository() {
    const root = await mkdtemp(path.join(os.tmpdir(), "repository-architecture-"));
    await cp(FIXTURE_ROOT, root, { recursive: true });
    await mkdir(path.join(root, ".git"), { recursive: true });
    return root;
}

export async function createGenericFixtureRepository() {
    const root = await mkdtemp(path.join(os.tmpdir(), "repository-architecture-generic-"));
    await cp(GENERIC_FIXTURE_ROOT, root, { recursive: true });
    await mkdir(path.join(root, ".git"), { recursive: true });
    return root;
}

export function outputPath(root) {
    return path.join(root, "documentation", "repository-architecture", "index.html");
}
