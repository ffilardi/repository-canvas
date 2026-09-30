import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { validateGraph } from "./graph-contract.mjs";
import { renderHtml } from "./renderer.mjs";
import { scanRepository, searchGraph } from "./scanner.mjs";

const servers = new Map();
const extensionDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(extensionDirectory, "..", "..", "..");

function jsonResponse(res, statusCode, value) {
    const body = JSON.stringify(value);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
    });
    res.end(body);
}

function pushGraph(entry) {
    const payload = `event: graph\ndata: ${JSON.stringify(entry.graph)}\n\n`;
    for (const client of entry.clients) {
        client.write(payload);
    }
}

async function refreshEntry(entry, options = entry.options) {
    entry.options = {
        includeArchived: options?.includeArchived === true,
    };
    entry.graph = validateGraph(await scanRepository(workspaceRoot, entry.options));
    if (entry.options.includeArchived) {
        entry.hasArchivedSnapshot = entry.graph.nodes.some((node) => node.archived);
    }
    pushGraph(entry);
    return entry.graph;
}

async function startServer(instanceId, options) {
    const entry = {
        instanceId,
        options: { includeArchived: options?.includeArchived === true },
        graph: undefined,
        clients: new Set(),
        server: undefined,
        url: undefined,
    };
    entry.graph = validateGraph(await scanRepository(workspaceRoot, entry.options));
    const archivedGraph = validateGraph(
        await scanRepository(workspaceRoot, { includeArchived: true }),
    );
    entry.hasArchivedSnapshot = archivedGraph.nodes.some((node) => node.archived);

    const server = createServer(async (req, res) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        try {
            const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
            if (req.method === "GET" && requestUrl.pathname === "/") {
                const html = renderHtml({
                    mode: "canvas",
                    hasArchivedSnapshot: entry.hasArchivedSnapshot,
                });
                res.writeHead(200, {
                    "Content-Type": "text/html; charset=utf-8",
                    "Content-Length": Buffer.byteLength(html),
                    "Cache-Control": "no-store",
                    "Content-Security-Policy":
                        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
                });
                res.end(html);
                return;
            }
            if (req.method === "GET" && requestUrl.pathname === "/api/graph") {
                jsonResponse(res, 200, entry.graph);
                return;
            }
            if (req.method === "POST" && requestUrl.pathname === "/api/refresh") {
                const includeArchived = requestUrl.searchParams.get("includeArchived");
                if (includeArchived !== null && !["true", "false"].includes(includeArchived)) {
                    jsonResponse(res, 400, {
                        error: 'The "includeArchived" query parameter must be "true" or "false".',
                    });
                    return;
                }
                const options =
                    includeArchived === null
                        ? entry.options
                        : { includeArchived: includeArchived === "true" };
                jsonResponse(res, 200, await refreshEntry(entry, options));
                return;
            }
            if (req.method === "GET" && requestUrl.pathname === "/events") {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                });
                res.write(": connected\n\n");
                entry.clients.add(res);
                req.on("close", () => entry.clients.delete(res));
                return;
            }
            jsonResponse(res, 404, { error: "Not found" });
        } catch (error) {
            jsonResponse(res, 500, {
                error: error instanceof Error ? error.message : "Architecture scan failed",
            });
        }
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    entry.server = server;
    entry.url = `http://127.0.0.1:${port}/`;
    return entry;
}

function requireEntry(instanceId) {
    const entry = servers.get(instanceId);
    if (!entry) {
        throw new CanvasError(
            "architecture_not_open",
            "Open the repository architecture canvas before invoking this action.",
        );
    }
    return entry;
}

await joinSession({
    canvases: [
        createCanvas({
            id: "repository-architecture",
            displayName: "Repository architecture",
            description:
                "Interactive repository map of applications, APIs, infrastructure, dependencies, connections, and data flows.",
            inputSchema: {
                type: "object",
                properties: {
                    includeArchived: {
                        type: "boolean",
                        description: "Include applications under archive/ in the map.",
                        default: false,
                    },
                },
                additionalProperties: false,
            },
            actions: [
                {
                    name: "refresh",
                    description: "Rescan the repository and refresh the architecture graph.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            includeArchived: {
                                type: "boolean",
                                description: "Include applications under archive/ in the refreshed graph.",
                            },
                        },
                        additionalProperties: false,
                    },
                    handler: async (ctx) => {
                        const entry = requireEntry(ctx.instanceId);
                        const options = {
                            includeArchived:
                                typeof ctx.input?.includeArchived === "boolean"
                                    ? ctx.input.includeArchived
                                    : entry.options.includeArchived,
                        };
                        const graph = await refreshEntry(entry, options);
                        return {
                            generatedAt: graph.generatedAt,
                            durationMs: graph.durationMs,
                            summary: graph.summary,
                        };
                    },
                },
                {
                    name: "get_summary",
                    description: "Return counts and category coverage for the current repository map.",
                    handler: (ctx) => {
                        const graph = requireEntry(ctx.instanceId).graph;
                        return {
                            generatedAt: graph.generatedAt,
                            durationMs: graph.durationMs,
                            summary: graph.summary,
                        };
                    },
                },
                {
                    name: "find_component",
                    description: "Find repository components by name, path, kind, or technology.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                minLength: 1,
                                description: "Component name, path, kind, or technology to search for.",
                            },
                        },
                        required: ["query"],
                        additionalProperties: false,
                    },
                    handler: (ctx) => {
                        const graph = requireEntry(ctx.instanceId).graph;
                        return searchGraph(graph, ctx.input.query).map((node) => ({
                            id: node.id,
                            name: node.displayName,
                            kind: node.kind,
                            category: node.category,
                            path: node.path,
                            technologies: node.technologies,
                        }));
                    },
                },
                {
                    name: "get_component",
                    description:
                        "Return one component with its incoming and outgoing relationships and evidence.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            id: {
                                type: "string",
                                minLength: 1,
                                description: "Component ID returned by find_component.",
                            },
                        },
                        required: ["id"],
                        additionalProperties: false,
                    },
                    handler: (ctx) => {
                        const graph = requireEntry(ctx.instanceId).graph;
                        const node = graph.nodes.find((candidate) => candidate.id === ctx.input.id);
                        if (!node) {
                            throw new CanvasError(
                                "component_not_found",
                                `No architecture component exists with ID "${ctx.input.id}".`,
                            );
                        }
                        return {
                            ...node,
                            outgoing: graph.edges.filter((edge) => edge.source === node.id),
                            incoming: graph.edges.filter((edge) => edge.target === node.id),
                        };
                    },
                },
            ],
            open: async (ctx) => {
                const options = {
                    includeArchived: ctx.input?.includeArchived === true,
                };
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId, options);
                    servers.set(ctx.instanceId, entry);
                } else if (entry.options.includeArchived !== options.includeArchived) {
                    await refreshEntry(entry, options);
                }
                return {
                    title: "Repository architecture",
                    status: `${entry.graph.summary.components} components · ${entry.graph.summary.relationships} relationships`,
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (!entry) return;
                servers.delete(ctx.instanceId);
                for (const client of entry.clients) client.end();
                await new Promise((resolve) => entry.server.close(resolve));
            },
        }),
    ],
});
