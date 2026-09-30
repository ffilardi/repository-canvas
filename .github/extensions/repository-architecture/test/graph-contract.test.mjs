import assert from "node:assert/strict";
import test from "node:test";
import { validateGraph } from "../graph-contract.mjs";
import { scanRepository } from "../scanner.mjs";
import { FIXTURE_ROOT } from "./helpers.mjs";

async function validGraph() {
    return structuredClone(await scanRepository(FIXTURE_ROOT));
}

test("contract accepts a scanner graph", async () => {
    validateGraph(await validGraph());
});

test("contract rejects duplicate node IDs", async () => {
    const graph = await validGraph();
    graph.nodes.push(structuredClone(graph.nodes[0]));
    await assert.rejects(async () => validateGraph(graph), /duplicated/);
});

test("contract rejects dangling edges", async () => {
    const graph = await validGraph();
    graph.edges[0].target = "component:missing";
    await assert.rejects(async () => validateGraph(graph), /does not reference a node/);
});

test("contract rejects incorrect summary counts", async () => {
    const graph = await validGraph();
    graph.summary.systems += 1;
    await assert.rejects(async () => validateGraph(graph), /summary\.systems/);
});

test("contract rejects absolute evidence paths", async () => {
    const graph = await validGraph();
    graph.edges[0].evidence = ["C:\\private\\source.env"];
    await assert.rejects(async () => validateGraph(graph), /repository-relative/);
});

test("contract rejects credential-like values", async () => {
    const graph = await validGraph();
    graph.nodes[0].description = "AccountKey=do-not-publish";
    await assert.rejects(async () => validateGraph(graph), /credential-like/);
});

test("contract rejects unsupported resource environments", async () => {
    const graph = await validGraph();
    const node = graph.nodes.find((candidate) => candidate.azureResources.length);
    node.azureResources[0].environment = "Test";
    await assert.rejects(async () => validateGraph(graph), /Development, UAT, or Production/);
});
