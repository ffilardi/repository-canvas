import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
    GRAPH_SCHEMA_VERSION,
    stableGraphPayload,
    stableStringify,
    validateGraph,
} from "./graph-contract.mjs";
import { renderHtml } from "./renderer.mjs";
import { scanRepository } from "./scanner.mjs";

const execFileAsync = promisify(execFile);
const EXTENSION_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = "documentation/repository-architecture/index.html";
const GENERATOR_PATH = ".github/extensions/repository-architecture/generate-static.mjs";
const REGENERATION_COMMAND =
    "PowerShell: .\\documentation\\repository-architecture\\refresh.ps1 | Bash: bash documentation/repository-architecture/refresh.sh";
const SOURCE_FILES = [
    "architecture-profile.mjs",
    "generate-static.mjs",
    "graph-contract.mjs",
    "renderer.mjs",
    "scanner.mjs",
];

function usageError(message) {
    return new Error(
        `${message}\nUsage: node ${GENERATOR_PATH} --repo-root <path> --output ${OUTPUT_PATH} [--check]`,
    );
}

export function parseArguments(args) {
    const options = { check: false };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--check") {
            options.check = true;
            continue;
        }
        if (argument === "--repo-root" || argument === "--output") {
            const value = args[index + 1];
            if (!value || value.startsWith("--")) {
                throw usageError(`${argument} requires a value.`);
            }
            options[argument === "--repo-root" ? "repoRoot" : "output"] = value;
            index += 1;
            continue;
        }
        throw usageError(`Unknown argument: ${argument}`);
    }
    if (!options.repoRoot) throw usageError("--repo-root is required.");
    if (!options.output) throw usageError("--output is required.");
    return options;
}

async function resolvePaths(options) {
    const repoRoot = path.resolve(options.repoRoot);
    const rootStats = await stat(repoRoot).catch(() => undefined);
    if (!rootStats?.isDirectory()) {
        throw new Error(`Repository root is not a directory: ${options.repoRoot}`);
    }
    const gitEntry = await stat(path.join(repoRoot, ".git")).catch(() => undefined);
    if (!gitEntry) {
        throw new Error(`Repository root does not contain .git: ${options.repoRoot}`);
    }
    const expectedOutput = path.resolve(repoRoot, ...OUTPUT_PATH.split("/"));
    const requestedOutput = path.resolve(repoRoot, options.output);
    if (requestedOutput !== expectedOutput) {
        throw new Error(`Output must resolve to ${OUTPUT_PATH}.`);
    }
    return { repoRoot, outputPath: expectedOutput };
}

async function gitValue(repoRoot, args) {
    try {
        const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
            encoding: "utf8",
            windowsHide: true,
        });
        return stdout.trim();
    } catch {
        return undefined;
    }
}

function repositoryNameFromRemote(remoteUrl) {
    if (!remoteUrl) return undefined;
    const withoutQuery = remoteUrl.split(/[?#]/, 1)[0].replace(/[\\/]+$/, "");
    const name = withoutQuery.split(/[\\/]/).pop()?.replace(/\.git$/i, "");
    return name || undefined;
}

async function generationContext(repoRoot) {
    const remoteUrl = await gitValue(repoRoot, ["config", "--get", "remote.origin.url"]);
    const graphInputRevision = await gitValue(repoRoot, ["rev-parse", "--short=12", "HEAD"]);
    return {
        repositoryName: repositoryNameFromRemote(remoteUrl) ?? path.basename(repoRoot),
        graphInputRevision: graphInputRevision ?? "unavailable",
    };
}

async function sourceFingerprint(defaultGraph, archivedGraph) {
    const hash = createHash("sha256");
    hash.update(
        stableStringify({
            defaultGraph: stableGraphPayload(defaultGraph),
            archivedGraph: stableGraphPayload(archivedGraph),
        }),
    );
    for (const fileName of SOURCE_FILES) {
        hash.update(`\n${fileName}\n`);
        const source = await readFile(path.join(EXTENSION_DIRECTORY, fileName), "utf8");
        hash.update(source.replace(/\r\n/g, "\n"));
    }
    return hash.digest("hex");
}

function generatedFileHeader() {
    return `<!--
GENERATED FILE - DO NOT EDIT.
Source generator: ${GENERATOR_PATH}
Regenerate: ${REGENERATION_COMMAND}
Manual edits will be overwritten.
-->
`;
}

function validateStandaloneHtml(html) {
    const forbidden = [
        [/\bfetch\s*\(/, "fetch"],
        [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
        [/\bEventSource\b/, "EventSource"],
        [/\bimport\s*\(/, "dynamic import"],
        [/<(?:script|link|img)\b[^>]+(?:src|href)=["']https?:/i, "external asset"],
    ];
    for (const [pattern, name] of forbidden) {
        if (pattern.test(html)) {
            throw new Error(`Standalone output contains forbidden network capability: ${name}.`);
        }
    }
    if (!html.includes('id="graph-default"') || !html.includes('id="graph-archived"')) {
        throw new Error("Standalone output is missing an embedded graph dataset.");
    }
    if (!html.startsWith("<!--\nGENERATED FILE - DO NOT EDIT.")) {
        throw new Error("Standalone output is missing the generated-file warning.");
    }
}

function extractMetadata(html) {
    const match = html.match(
        /<script type="application\/json" id="page-metadata">([\s\S]*?)<\/script>/,
    );
    if (!match) throw new Error("Generated page does not contain architecture metadata.");
    try {
        return JSON.parse(match[1]);
    } catch (error) {
        throw new Error(
            `Generated page contains invalid architecture metadata: ${
                error instanceof Error ? error.message : "parse failed"
            }`,
        );
    }
}

function extractGraph(html, id) {
    const match = html.match(
        new RegExp(
            `<script type="application/json" id="${id}">([\\s\\S]*?)<\\/script>`,
        ),
    );
    if (!match) throw new Error(`Generated page does not contain dataset "${id}".`);
    try {
        return validateGraph(JSON.parse(match[1]));
    } catch (error) {
        throw new Error(
            `Generated page contains invalid dataset "${id}": ${
                error instanceof Error ? error.message : "parse failed"
            }`,
        );
    }
}

export async function createStaticSite(options) {
    const { repoRoot, outputPath } = await resolvePaths(options);
    const context = await generationContext(repoRoot);
    const generatedAt = new Date().toISOString();

    const [defaultGraph, archivedGraph] = await Promise.all([
        scanRepository(repoRoot),
        scanRepository(repoRoot, { includeArchived: true }),
    ]);
    defaultGraph.workspaceName = context.repositoryName;
    archivedGraph.workspaceName = context.repositoryName;
    validateGraph(defaultGraph);
    validateGraph(archivedGraph);

    const fingerprint = await sourceFingerprint(defaultGraph, archivedGraph);
    const metadata = {
        schemaVersion: GRAPH_SCHEMA_VERSION,
        generatedAt,
        fingerprint,
        graphInputRevision: context.graphInputRevision,
        generator: GENERATOR_PATH,
        regenerationCommand: REGENERATION_COMMAND,
    };

    if (options.check) {
        const existing = await readFile(outputPath, "utf8").catch(() => undefined);
        if (!existing) {
            throw new Error(
                `Generated architecture page is missing. Run:\n${REGENERATION_COMMAND}`,
            );
        }
        validateStandaloneHtml(existing);
        const existingMetadata = extractMetadata(existing);
        const existingDefaultGraph = extractGraph(existing, "graph-default");
        const existingArchivedGraph = extractGraph(existing, "graph-archived");
        const payloadMatches =
            stableStringify(stableGraphPayload(existingDefaultGraph)) ===
                stableStringify(stableGraphPayload(defaultGraph)) &&
            stableStringify(stableGraphPayload(existingArchivedGraph)) ===
                stableStringify(stableGraphPayload(archivedGraph));
        if (
            existingMetadata.schemaVersion !== GRAPH_SCHEMA_VERSION ||
            existingMetadata.fingerprint !== fingerprint ||
            !payloadMatches
        ) {
            throw new Error(
                `Generated architecture page is stale. Run:\n${REGENERATION_COMMAND}`,
            );
        }
        return { status: "current", outputPath, metadata: existingMetadata };
    }

    const html =
        generatedFileHeader() +
        renderHtml({
            mode: "standalone",
            graph: defaultGraph,
            archivedGraph,
            hasArchivedSnapshot: archivedGraph.nodes.some((node) => node.archived),
            metadata,
        });
    validateStandaloneHtml(html);

    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    try {
        await writeFile(temporaryPath, html, "utf8");
        await rename(temporaryPath, outputPath);
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
    return { status: "generated", outputPath, metadata };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
    try {
        const result = await createStaticSite(parseArguments(process.argv.slice(2)));
        process.stdout.write(
            result.status === "current"
                ? `Repository architecture page is current: ${OUTPUT_PATH}\n`
                : `Generated repository architecture page: ${OUTPUT_PATH}\n`,
        );
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
