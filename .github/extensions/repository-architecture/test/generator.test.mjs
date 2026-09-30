import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createStaticSite } from "../generate-static.mjs";
import { createFixtureRepository, outputPath } from "./helpers.mjs";

const GENERATOR_OPTIONS = {
    output: "documentation/repository-architecture/index.html",
};

test("generator emits one safe, self-contained HTML file and check mode passes", async () => {
    const root = await createFixtureRepository();
    try {
        await createStaticSite({ ...GENERATOR_OPTIONS, repoRoot: root, check: false });
        const html = await readFile(outputPath(root), "utf8");

        assert.match(html, /^<!--\nGENERATED FILE - DO NOT EDIT\./);
        assert(html.includes('id="graph-default"'));
        assert(html.includes('id="graph-archived"'));
        assert(html.includes("\\u003c/script\\u003e"));
        assert(html.includes("\\u0026"));
        assert(html.includes("Unicode ✓"));
        assert(!/\bfetch\s*\(/.test(html));
        assert(!/\bXMLHttpRequest\b/.test(html));
        assert(!/\bEventSource\b/.test(html));
        assert(!/<(?:script|link|img)\b[^>]+(?:src|href)=["']https?:/i.test(html));

        const result = await createStaticSite({
            ...GENERATOR_OPTIONS,
            repoRoot: root,
            check: true,
        });
        assert.equal(result.status, "current");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("check mode detects stale output", async () => {
    const root = await createFixtureRepository();
    try {
        await createStaticSite({ ...GENERATOR_OPTIONS, repoRoot: root, check: false });
        const packagePath = path.join(root, "frontend", "patient-web", "package.json");
        const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
        packageJson.version = "1.0.1";
        await writeFile(packagePath, JSON.stringify(packageJson), "utf8");

        await assert.rejects(
            createStaticSite({ ...GENERATOR_OPTIONS, repoRoot: root, check: true }),
            /page is stale/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("check mode detects modified embedded graph content", async () => {
    const root = await createFixtureRepository();
    try {
        await createStaticSite({ ...GENERATOR_OPTIONS, repoRoot: root, check: false });
        const generatedPath = outputPath(root);
        const html = await readFile(generatedPath, "utf8");
        await writeFile(
            generatedPath,
            html.replace('"workspaceName":"', '"workspaceName":"tampered-'),
            "utf8",
        );

        await assert.rejects(
            createStaticSite({ ...GENERATOR_OPTIONS, repoRoot: root, check: true }),
            /page is stale/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("failed generation preserves the previous valid page", async () => {
    const root = await createFixtureRepository();
    try {
        await createStaticSite({ ...GENERATOR_OPTIONS, repoRoot: root, check: false });
        const before = await readFile(outputPath(root), "utf8");
        await writeFile(path.join(root, "backend", "sample-api", "package.json"), "{broken", "utf8");

        await assert.rejects(
            createStaticSite({ ...GENERATOR_OPTIONS, repoRoot: root, check: false }),
            /Invalid JSON/,
        );
        assert.equal(await readFile(outputPath(root), "utf8"), before);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("generator only writes to the configured repository path", async () => {
    const root = await createFixtureRepository();
    try {
        await assert.rejects(
            createStaticSite({ repoRoot: root, output: "other.html", check: false }),
            /Output must resolve/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
