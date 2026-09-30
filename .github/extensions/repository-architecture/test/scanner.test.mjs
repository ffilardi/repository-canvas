import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { stableGraphPayload, stableStringify, validateGraph } from "../graph-contract.mjs";
import { scanRepository, searchGraph } from "../scanner.mjs";
import { createFixtureRepository, FIXTURE_ROOT } from "./helpers.mjs";

test("scanner discovers components, relationships, delivery, and environment resources", async () => {
    const graph = validateGraph(await scanRepository(FIXTURE_ROOT));
    const frontend = graph.nodes.find((node) => node.id === "component:frontend/patient-web");
    const backend = graph.nodes.find((node) => node.id === "component:backend/sample-api");

    assert(frontend);
    assert(backend);
    assert.equal(frontend.kind, "React frontend");
    assert.equal(backend.kind, "GraphQL API");
    assert(backend.technologies.includes("MongoDB"));
    assert(backend.pipelines.includes(".azdevops/workflows/deploy-sample-api.yml"));
    assert(
        backend.azureResources.some(
            (resource) =>
                resource.type === "Container App" && resource.name === "ctapsampleapidiprd",
        ),
    );
    assert(
        backend.azureResources.some(
            (resource) =>
                resource.environment === "Production" &&
                resource.type === "Resource Group" &&
                resource.name === "fixture-rg-prod",
        ),
    );
    assert(
        backend.azureResources.some(
            (resource) =>
                resource.environment === "Production" &&
                resource.type === "Container App" &&
                resource.name === "ctapworkerdiprd",
        ),
    );
    assert(
        !backend.azureResources.some(
            (resource) =>
                resource.environment !== "Production" &&
                resource.name.startsWith("ctapworker"),
        ),
    );
    assert(
        backend.azureResources.some(
            (resource) =>
                resource.environment === "Development" &&
                resource.type === "Container App" &&
                resource.name === "ctapsampleapididev",
        ),
    );
    assert(
        backend.azureResources.some(
            (resource) =>
                resource.environment === "UAT" &&
                resource.type === "Container App" &&
                resource.name === "ctapsampleapidiuat",
        ),
    );
    assert(
        backend.azureResources.some(
            (resource) =>
                resource.environment === "Production" &&
                resource.type === "External endpoint" &&
                resource.name === "vendor.example.com",
        ),
    );
    assert(
        graph.edges.some(
            (edge) => edge.source === frontend.id && edge.target === backend.id,
        ),
    );
    assert(!JSON.stringify(graph).includes("must-not-appear"));
});

test("scanner excludes archive by default and includes it explicitly", async () => {
    const current = validateGraph(await scanRepository(FIXTURE_ROOT));
    const archived = validateGraph(
        await scanRepository(FIXTURE_ROOT, { includeArchived: true }),
    );

    assert(!current.nodes.some((node) => node.archived));
    assert(
        archived.nodes.some(
            (node) => node.id === "component:archive/frontend/legacy-web" && node.archived,
        ),
    );
});

test("scanner output is deterministic apart from timing fields", async () => {
    const first = await scanRepository(FIXTURE_ROOT);
    const second = await scanRepository(FIXTURE_ROOT);
    assert.equal(
        stableStringify(stableGraphPayload(first)),
        stableStringify(stableGraphPayload(second)),
    );
});

test("scanner reports malformed supported JSON with repository-relative context", async () => {
    const root = await createFixtureRepository();
    try {
        await writeFile(path.join(root, "backend", "sample-api", "package.json"), "{broken", "utf8");
        await assert.rejects(
            scanRepository(root),
            /Invalid JSON in backend\/sample-api\/package\.json/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("graph search matches names, paths, and technologies", async () => {
    const graph = await scanRepository(FIXTURE_ROOT);
    assert.equal(searchGraph(graph, "patient web")[0]?.id, "component:frontend/patient-web");
    assert(
        searchGraph(graph, "mongodb").some(
            (node) => node.id === "component:backend/sample-api",
        ),
    );
});
