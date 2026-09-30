import path from "node:path";

export const GRAPH_SCHEMA_VERSION = 2;

const RESOURCE_ENVIRONMENTS = new Set(["Development", "UAT", "Production"]);

const NODE_CATEGORIES = new Set([
    "backend",
    "data",
    "delivery",
    "documentation",
    "external",
    "frontend",
    "infrastructure",
    "library",
    "platform",
    "quality",
]);

const EDGE_CONFIDENCE = new Set(["detected", "inferred"]);

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Invalid repository architecture graph: ${message}`);
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertString(value, location, { allowEmpty = false } = {}) {
    assert(typeof value === "string", `${location} must be a string`);
    if (!allowEmpty) assert(value.length > 0, `${location} must not be empty`);
}

function assertStringArray(value, location) {
    assert(Array.isArray(value), `${location} must be an array`);
    value.forEach((item, index) => assertString(item, `${location}[${index}]`));
}

function isAbsoluteLocalPath(value) {
    return path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

function assertRelativePath(value, location) {
    assertString(value, location);
    assert(!isAbsoluteLocalPath(value), `${location} must be repository-relative`);
    assert(!value.split(/[\\/]/).includes(".."), `${location} must not escape the repository`);
}

function evidencePath(value) {
    return value.split(" (", 1)[0];
}

function assertEvidence(value, location) {
    assertString(value, location);
    assertRelativePath(evidencePath(value), location);
}

function assertNoSensitiveValues(value, location = "graph") {
    if (typeof value === "string") {
        const sensitivePatterns = [
            /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
            /\b(?:SharedAccessKey|AccountKey|ClientSecret|Client_Secret|Password|Secret)\s*=/i,
            /https?:\/\/[^/\s:@]+:[^@\s/]+@/i,
            /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
            /[?&](?:sig|token|code)=[^&#\s]+/i,
        ];
        assert(
            !sensitivePatterns.some((pattern) => pattern.test(value)),
            `${location} contains credential-like content`,
        );
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoSensitiveValues(item, `${location}[${index}]`));
        return;
    }
    if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) {
            assertNoSensitiveValues(item, `${location}.${key}`);
        }
    }
}

function validateEndpoint(endpoint, location) {
    assert(isRecord(endpoint), `${location} must be an object`);
    assertString(endpoint.name, `${location}.name`);
    assertString(endpoint.url, `${location}.url`);
    assert(/^https?:\/\//.test(endpoint.url), `${location}.url must use HTTP or HTTPS`);
    assertEvidence(endpoint.evidence, `${location}.evidence`);
}

function validateAzureResource(resource, location) {
    assert(isRecord(resource), `${location} must be an object`);
    assertString(resource.type, `${location}.type`);
    assertString(resource.name, `${location}.name`);
    assert(
        RESOURCE_ENVIRONMENTS.has(resource.environment),
        `${location}.environment must be Development, UAT, or Production`,
    );
    assertStringArray(resource.evidence, `${location}.evidence`);
    resource.evidence.forEach((item, index) =>
        assertEvidence(item, `${location}.evidence[${index}]`),
    );
}

function validateNode(node, index) {
    const location = `nodes[${index}]`;
    assert(isRecord(node), `${location} must be an object`);
    for (const field of ["id", "name", "displayName", "description", "category", "kind"]) {
        assertString(node[field], `${location}.${field}`);
    }
    assert(NODE_CATEGORIES.has(node.category), `${location}.category is unsupported`);
    assertStringArray(node.technologies, `${location}.technologies`);
    assertStringArray(node.manifests, `${location}.manifests`);
    assertStringArray(node.pipelines, `${location}.pipelines`);
    node.manifests.forEach((item, itemIndex) =>
        assertRelativePath(item, `${location}.manifests[${itemIndex}]`),
    );
    node.pipelines.forEach((item, itemIndex) =>
        assertRelativePath(item, `${location}.pipelines[${itemIndex}]`),
    );
    assert(Array.isArray(node.endpoints), `${location}.endpoints must be an array`);
    node.endpoints.forEach((endpoint, endpointIndex) =>
        validateEndpoint(endpoint, `${location}.endpoints[${endpointIndex}]`),
    );
    assert(Array.isArray(node.azureResources), `${location}.azureResources must be an array`);
    node.azureResources.forEach((resource, resourceIndex) =>
        validateAzureResource(resource, `${location}.azureResources[${resourceIndex}]`),
    );
    if (node.path !== undefined) assertRelativePath(node.path, `${location}.path`);
    if (node.version !== undefined) assertString(node.version, `${location}.version`);
    if (node.archived !== undefined) {
        assert(typeof node.archived === "boolean", `${location}.archived must be a boolean`);
    }
    if (node.virtual !== undefined) {
        assert(typeof node.virtual === "boolean", `${location}.virtual must be a boolean`);
    }
}

function validateEdge(edge, index, nodeIds) {
    const location = `edges[${index}]`;
    assert(isRecord(edge), `${location} must be an object`);
    for (const field of ["id", "source", "target", "relation", "confidence"]) {
        assertString(edge[field], `${location}.${field}`);
    }
    assert(nodeIds.has(edge.source), `${location}.source does not reference a node`);
    assert(nodeIds.has(edge.target), `${location}.target does not reference a node`);
    assert(edge.source !== edge.target, `${location} must not be a self-reference`);
    assert(EDGE_CONFIDENCE.has(edge.confidence), `${location}.confidence is unsupported`);
    assertStringArray(edge.evidence, `${location}.evidence`);
    edge.evidence.forEach((item, itemIndex) =>
        assertEvidence(item, `${location}.evidence[${itemIndex}]`),
    );
}

export function validateGraph(graph) {
    assert(isRecord(graph), "root must be an object");
    assert(graph.schemaVersion === GRAPH_SCHEMA_VERSION, `schemaVersion must be ${GRAPH_SCHEMA_VERSION}`);
    assertString(graph.generatedAt, "generatedAt");
    assert(!Number.isNaN(Date.parse(graph.generatedAt)), "generatedAt must be an ISO date");
    assert(
        Number.isInteger(graph.durationMs) && graph.durationMs >= 0,
        "durationMs must be a non-negative integer",
    );
    assertString(graph.workspaceName, "workspaceName");
    assert(isRecord(graph.options), "options must be an object");
    assert(typeof graph.options.includeArchived === "boolean", "options.includeArchived must be boolean");
    if (graph.options.profileVersion !== undefined) {
        assert(
            Number.isInteger(graph.options.profileVersion) && graph.options.profileVersion > 0,
            "options.profileVersion must be a positive integer",
        );
    }
    assert(Array.isArray(graph.nodes), "nodes must be an array");
    assert(Array.isArray(graph.edges), "edges must be an array");
    assert(isRecord(graph.summary), "summary must be an object");
    assert(isRecord(graph.summary.categories), "summary.categories must be an object");

    const nodeIds = new Set();
    graph.nodes.forEach((node, index) => {
        validateNode(node, index);
        assert(!nodeIds.has(node.id), `node ID "${node.id}" is duplicated`);
        nodeIds.add(node.id);
    });

    const edgeIds = new Set();
    graph.edges.forEach((edge, index) => {
        validateEdge(edge, index, nodeIds);
        assert(!edgeIds.has(edge.id), `edge ID "${edge.id}" is duplicated`);
        edgeIds.add(edge.id);
    });

    const categoryCounts = {};
    for (const node of graph.nodes) {
        categoryCounts[node.category] = (categoryCounts[node.category] ?? 0) + 1;
    }
    assert(
        graph.summary.components === graph.nodes.filter((node) => !node.virtual).length,
        "summary.components does not match nodes",
    );
    assert(graph.summary.systems === graph.nodes.length, "summary.systems does not match nodes");
    assert(
        graph.summary.relationships === graph.edges.length,
        "summary.relationships does not match edges",
    );
    assert(
        JSON.stringify(graph.summary.categories) ===
            JSON.stringify(
                Object.fromEntries(
                    Object.entries(categoryCounts).sort(([left], [right]) =>
                        left.localeCompare(right),
                    ),
                ),
            ),
        "summary.categories does not match nodes",
    );

    assertNoSensitiveValues(graph);
    return graph;
}

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
        Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonicalValue(item)]),
    );
}

export function stableStringify(value) {
    return JSON.stringify(canonicalValue(value));
}

export function stableGraphPayload(graph) {
    const { generatedAt: _generatedAt, durationMs: _durationMs, ...stableGraph } = graph;
    return stableGraph;
}
