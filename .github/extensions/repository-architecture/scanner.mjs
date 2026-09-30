import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ARCHITECTURE_PROFILE } from "./architecture-profile.mjs";
import { GRAPH_SCHEMA_VERSION } from "./graph-contract.mjs";

const SKIPPED_DIRECTORIES = new Set([
    ".git",
    ".idea",
    ".vscode",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "obj",
]);

const GENERATED_OUTPUT_SUFFIX = "documentation/repository-architecture/index.html";

const COMPONENT_ROOTS = ARCHITECTURE_PROFILE.componentRoots;
const STANDALONE_COMPONENTS = ARCHITECTURE_PROFILE.standaloneComponents;
const ARCHIVE_ROOTS = ARCHITECTURE_PROFILE.archiveRoots;
const WORKFLOW_ROOTS = ARCHITECTURE_PROFILE.workflowRoots;
const RESOURCE_DEFINITIONS = ARCHITECTURE_PROFILE.resourceDefinitions;
const TECHNOLOGY_RULES = ARCHITECTURE_PROFILE.technologyRules;
const AZURE_RESOURCE_PARAMETER_RULES = ARCHITECTURE_PROFILE.azureResourceParameterRules;
const RESOURCE_NODE_BY_AZURE_TYPE = new Map(
    Object.entries(ARCHITECTURE_PROFILE.resourceNodeByAzureType),
);
const DEPLOYMENT_ENVIRONMENTS = new Map(
    Object.entries(ARCHITECTURE_PROFILE.deploymentEnvironments),
);

async function exists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function readText(filePath, displayPath) {
    try {
        return await readFile(filePath, "utf8");
    } catch (error) {
        throw new Error(
            `Unable to read ${displayPath}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
    }
}

async function readJson(filePath, displayPath) {
    let content;
    try {
        content = await readFile(filePath, "utf8");
    } catch (error) {
        throw new Error(
            `Unable to read ${displayPath}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
    }
    try {
        return JSON.parse(content.replace(/^\uFEFF/, ""));
    } catch (error) {
        throw new Error(
            `Invalid JSON in ${displayPath}: ${error instanceof Error ? error.message : "parse failed"}`,
        );
    }
}

async function listDirectories(directory, displayPath, optional = true) {
    try {
        const entries = await readdir(directory, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name))
            .map((entry) => entry.name)
            .sort();
    } catch (error) {
        if (optional && error?.code === "ENOENT") return [];
        throw new Error(
            `Unable to read directory ${displayPath}: ${
                error instanceof Error ? error.message : "unknown error"
            }`,
        );
    }
}

async function collectFiles(directory, maxDepth = 3, relativeBase = directory, depth = 0) {
    if (depth > maxDepth) {
        return [];
    }

    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        const displayPath = path.relative(relativeBase, directory).replaceAll("\\", "/") || ".";
        throw new Error(
            `Unable to read directory ${displayPath}: ${
                error instanceof Error ? error.message : "unknown error"
            }`,
        );
    }

    const files = [];
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
                files.push(
                    ...(await collectFiles(
                        path.join(directory, entry.name),
                        maxDepth,
                        relativeBase,
                        depth + 1,
                    )),
                );
            }
        } else if (entry.isFile()) {
            const absolute = path.join(directory, entry.name);
            const normalizedAbsolute = absolute.replaceAll("\\", "/").toLowerCase();
            if (normalizedAbsolute.endsWith(GENERATED_OUTPUT_SUFFIX)) continue;
            files.push({
                absolute,
                relative: path
                    .relative(relativeBase, absolute)
                    .replaceAll("\\", "/"),
                name: entry.name,
            });
        }
    }
    return files;
}

function normalized(value) {
    return String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

function titleFromName(value) {
    if (ARCHITECTURE_PROFILE.displayNames[value]) {
        return ARCHITECTURE_PROFILE.displayNames[value];
    }
    return value
        .replace(/^graphql-be-/, "")
        .replace(/-new-tpl$/, "")
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function componentAliases(component) {
    const baseName = path.posix.basename(component.path);
    const candidates = new Set([
        baseName,
        component.name,
        component.packageName,
        baseName.replace(/^graphql-be-/, ""),
        baseName.replace(/-(backend|service|api|new-tpl)$/g, ""),
        baseName.replace(/-/g, ""),
    ]);

    for (const alias of ARCHITECTURE_PROFILE.knownAliases[baseName] ?? []) {
        candidates.add(alias);
    }

    return [...candidates].map(normalized).filter((alias) => alias.length >= 4);
}

function inferComponentType(component, files, dependencies) {
    const fileNames = new Set(files.map((file) => file.name.toLowerCase()));
    if (component.category === "frontend") {
        return dependencies.react ? "React frontend" : "Frontend application";
    }
    if (component.category === "infrastructure") {
        return "Infrastructure";
    }
    if (fileNames.has("schema.graphql") || dependencies.graphql || dependencies["@apollo/server"]) {
        return "GraphQL API";
    }
    if ([...fileNames].some((name) => name.endsWith(".csproj") || name.endsWith(".sln"))) {
        return ".NET service";
    }
    return component.kind;
}

function inferTechnologies(component, files, dependencies) {
    const technologies = new Set();
    const dependencyNames = Object.keys(dependencies);
    for (const [needle, technology] of TECHNOLOGY_RULES) {
        if (dependencyNames.some((dependency) => dependency === needle || dependency.startsWith(`${needle}/`))) {
            technologies.add(technology);
        }
    }

    const extensions = new Set(files.map((file) => path.extname(file.name).toLowerCase()));
    if (extensions.has(".bicep")) technologies.add("Bicep");
    if (extensions.has(".tf")) technologies.add("Terraform");
    if (extensions.has(".py")) technologies.add("Python");
    if (extensions.has(".cs") || extensions.has(".csproj")) technologies.add(".NET");
    if (extensions.has(".jmx")) technologies.add("JMeter");
    if (files.some((file) => /^dockerfile/i.test(file.name))) technologies.add("Docker");
    if (files.some((file) => /compose.*\.ya?ml$/i.test(file.name))) technologies.add("Docker Compose");
    for (const rule of ARCHITECTURE_PROFILE.technologyPathRules) {
        if (component.path === rule.path) technologies.add(rule.technology);
    }
    return [...technologies].sort();
}

function classifyAzureResourceParameter(parameterName) {
    if (/secret|password|token|username/i.test(parameterName)) {
        return undefined;
    }
    return AZURE_RESOURCE_PARAMETER_RULES.find(([pattern]) => pattern.test(parameterName))?.[1];
}

function addAzureResource(resourceMap, type, name, environment, evidence) {
    if (!type || typeof name !== "string" || !name.trim()) {
        return;
    }
    const normalizedName = name.trim();
    const key = `${environment}|${type}|${normalizedName.toLowerCase()}`;
    const existing = resourceMap.get(key);
    if (existing) {
        if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
        return;
    }
    resourceMap.set(key, {
        type,
        name: normalizedName,
        environment,
        evidence: [evidence],
    });
}

function addComponentAzureResource(component, type, name, environment, evidence) {
    if (!name || !environment) return;
    const existing = component.azureResources.find(
        (resource) =>
            resource.environment === environment &&
            resource.type === type &&
            resource.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
        if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
        return;
    }
    component.azureResources.push({
        type,
        name,
        environment,
        evidence: [evidence],
    });
}

function azureResourceFromEndpoint(value) {
    if (typeof value !== "string") return undefined;
    const match = value.match(/https?:\/\/([^/:;\s]+)/i);
    if (!match) return undefined;
    const hostname = match[1].toLowerCase();
    const resourceName = hostname.split(".")[0];
    if (hostname.endsWith(".azurecontainerapps.io") || /^ctap[a-z0-9-]+$/.test(resourceName)) {
        return { type: "Referenced Container App", name: resourceName };
    }
    if (hostname.endsWith(".azure-api.net")) {
        return { type: "API Management", name: resourceName };
    }
    if (hostname.endsWith(".azconfig.io")) {
        return { type: "App Configuration", name: resourceName };
    }
    if (hostname.endsWith(".azurecr.io")) {
        return { type: "Container Registry", name: resourceName };
    }
    if (hostname.endsWith(".vault.azure.net")) {
        return { type: "Key Vault", name: resourceName };
    }
    if (hostname.endsWith(".servicebus.windows.net")) {
        return { type: "Service Bus Namespace", name: resourceName };
    }
    if (hostname.endsWith(".redis.cache.windows.net")) {
        return { type: "Azure Cache for Redis", name: resourceName };
    }
    if (hostname.endsWith(".cognitiveservices.azure.com")) {
        return { type: "Azure AI Service", name: resourceName };
    }
    return { type: "External endpoint", name: hostname };
}

function bicepParameterDefaults(content) {
    const defaults = {};
    for (const match of content.matchAll(
        /^\s*param\s+([A-Za-z_][A-Za-z0-9_]*)\s+\w+\s*=\s*'([^']*)'/gm,
    )) {
        defaults[match[1]] = match[2];
    }
    return defaults;
}

function evaluateBicepValue(expression, values) {
    const cleaned = expression.trim().replace(/,\s*$/, "");
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)) {
        return typeof values[cleaned] === "string" ? values[cleaned] : undefined;
    }
    const literal = cleaned.match(/^'([^']*)'$/)?.[1];
    if (literal === undefined) {
        return undefined;
    }
    let complete = true;
    const value = literal.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, parameterName) => {
        const replacement = values[parameterName];
        if (typeof replacement !== "string") {
            complete = false;
            return "";
        }
        return replacement;
    });
    return complete ? value : undefined;
}

function bicepConditionalAssignments(content) {
    const assignments = [];
    const conditionStack = [];
    let depth = 0;

    for (const line of content.split(/\r?\n/)) {
        const conditionalBlock = line.match(
            /^\s*(?:module|resource)\s+\w+[\s\S]*?=\s*if\s*\((.+)\)\s*\{\s*$/,
        );
        if (conditionalBlock) {
            conditionStack.push({ depth: depth + 1, condition: conditionalBlock[1].trim() });
        }

        const assignment = line.match(
            /^\s*(containerAppName|webAppName)\s*:\s*([^\r\n]+)$/,
        );
        if (assignment) {
            assignments.push({
                field: assignment[1],
                expression: assignment[2],
                conditions: conditionStack.map((entry) => entry.condition),
            });
        }

        const withoutStrings = line.replace(/'[^']*'/g, "");
        depth += (withoutStrings.match(/\{/g) ?? []).length;
        depth -= (withoutStrings.match(/\}/g) ?? []).length;
        while (conditionStack.length && conditionStack.at(-1).depth > depth) {
            conditionStack.pop();
        }
    }

    return assignments;
}

function bicepConditionMatches(condition, values, content) {
    const aliases = new Map();
    for (const match of content.matchAll(
        /^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*toLower\(([A-Za-z_][A-Za-z0-9_]*)\)/gm,
    )) {
        aliases.set(match[1], String(values[match[2]] ?? "").toLowerCase());
    }
    const comparison = condition.match(
        /^\s*(?:toLower\()?([A-Za-z_][A-Za-z0-9_]*)(?:\))?\s*(==|!=)\s*'([^']+)'\s*$/,
    );
    if (!comparison) return true;
    const actual = aliases.has(comparison[1])
        ? aliases.get(comparison[1])
        : String(values[comparison[1]] ?? "");
    return comparison[2] === "==" ? actual === comparison[3] : actual !== comparison[3];
}

async function discoverAzureResources(componentPath, files) {
    const resourceMap = new Map();
    const environmentKeys = Object.keys(ARCHITECTURE_PROFILE.deploymentEnvironments)
        .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
    const parameterFilePattern = new RegExp(
        `\\.params\\.(${environmentKeys})\\.json$`,
        "i",
    );
    const parameterFiles = files
        .map((file) => ({
            file,
            environmentKey: file.name.match(parameterFilePattern)?.[1]?.toLowerCase(),
        }))
        .filter((entry) => entry.environmentKey);
    const bicepFiles = files.filter((file) => file.name.endsWith(".bicep"));

    for (const { file, environmentKey } of parameterFiles) {
        const environment = DEPLOYMENT_ENVIRONMENTS.get(environmentKey);
        const document = await readJson(file.absolute, `${componentPath}/${file.relative}`);
        const parameters = document?.parameters ?? {};
        const evidence = `${componentPath}/${file.relative}`;
        const parameterValues = {};
        for (const [parameterName, definition] of Object.entries(parameters)) {
            const value = definition?.value;
            parameterValues[parameterName] = value;
            const resourceType = classifyAzureResourceParameter(parameterName);
            if (resourceType) {
                for (const resourceName of Array.isArray(value) ? value : [value]) {
                    addAzureResource(resourceMap, resourceType, resourceName, environment, evidence);
                }
            }
            const endpointResource = azureResourceFromEndpoint(value);
            if (endpointResource) {
                addAzureResource(
                    resourceMap,
                    endpointResource.type,
                    endpointResource.name,
                    environment,
                    evidence,
                );
            }
        }
        for (const bicepFile of bicepFiles) {
            const content = await readText(
                bicepFile.absolute,
                `${componentPath}/${bicepFile.relative}`,
            );
            const values = { ...bicepParameterDefaults(content), ...parameterValues };
            const bicepEvidence = `${componentPath}/${bicepFile.relative}`;
            for (const assignment of bicepConditionalAssignments(content)) {
                if (
                    !assignment.conditions.every((condition) =>
                        bicepConditionMatches(condition, values, content),
                    )
                ) {
                    continue;
                }
                const name = evaluateBicepValue(assignment.expression, values);
                addAzureResource(
                    resourceMap,
                    assignment.field === "webAppName" ? "Web App" : "Container App",
                    name,
                    environment,
                    bicepEvidence,
                );
            }
        }
    }

    return [...resourceMap.values()].sort((left, right) =>
        `${left.environment}:${left.type}:${left.name}`.localeCompare(
            `${right.environment}:${right.type}:${right.name}`,
        ),
    );
}

async function buildComponent(workspaceRoot, definition) {
    const absolutePath = path.join(workspaceRoot, ...definition.path.split("/"));
    const files = await collectFiles(absolutePath);
    const packageFile = files.find((file) => file.relative === "package.json");
    const packageJson = packageFile
        ? await readJson(packageFile.absolute, `${definition.path}/${packageFile.relative}`)
        : undefined;
    const dependencies = {
        ...(packageJson?.dependencies ?? {}),
        ...(packageJson?.devDependencies ?? {}),
        ...(packageJson?.peerDependencies ?? {}),
    };
    const baseName = path.posix.basename(definition.path);
    const name = packageJson?.displayName || packageJson?.name || titleFromName(baseName);
    const schemas = files.filter((file) => file.name.endsWith(".graphql"));
    const composeFiles = files.filter((file) => /^(docker-)?compose.*\.ya?ml$/i.test(file.name));
    const envFiles = files.filter((file) => /^\.env\.(sample|example|template)$/i.test(file.name));
    const azureResources = await discoverAzureResources(definition.path, files);

    return {
        id: `component:${definition.path}`,
        name,
        displayName: titleFromName(baseName),
        packageName: packageJson?.name,
        version: packageJson?.version,
        description: packageJson?.description || definition.kind,
        category: definition.category,
        kind: inferComponentType(definition, files, dependencies),
        path: definition.path,
        archived: Boolean(definition.archived),
        technologies: inferTechnologies(definition, files, dependencies),
        dependencies,
        files,
        manifests: [
            packageFile?.relative,
            ...composeFiles.map((file) => file.relative),
            ...schemas.slice(0, 5).map((file) => file.relative),
        ].filter(Boolean),
        composeFiles,
        envFiles,
        schemaCount: schemas.length,
        pipelines: [],
        endpoints: [],
        azureResources,
    };
}

function addEdge(edgeMap, source, target, relation, evidence, confidence = "inferred") {
    if (!source || !target || source === target) {
        return;
    }
    const key = `${source}|${target}|${relation}`;
    const existing = edgeMap.get(key);
    if (existing) {
        if (evidence && !existing.evidence.includes(evidence)) {
            existing.evidence.push(evidence);
        }
        return;
    }
    edgeMap.set(key, {
        id: `edge:${edgeMap.size + 1}`,
        source,
        target,
        relation,
        confidence,
        evidence: evidence ? [evidence] : [],
    });
}

function ensureResourceNode(nodeMap, definition) {
    const id = `resource:${definition.id}`;
    if (!nodeMap.has(id)) {
        nodeMap.set(id, {
            id,
            name: definition.name,
            displayName: definition.name,
            description: definition.kind,
            category: definition.category,
            kind: definition.kind,
            technologies: [],
            manifests: [],
            pipelines: [],
            endpoints: [],
            azureResources: [],
            virtual: true,
        });
    }

    return id;
}

function attachAzureResourcesToPlatformNodes(components, nodeMap) {
    for (const component of components) {
        for (const resource of component.azureResources) {
            const resourceId = RESOURCE_NODE_BY_AZURE_TYPE.get(resource.type);
            if (!resourceId) continue;
            const definition = RESOURCE_DEFINITIONS.find((candidate) => candidate.id === resourceId);
            const nodeId = ensureResourceNode(nodeMap, definition);
            const node = nodeMap.get(nodeId);
            const existing = node.azureResources.find(
                (candidate) =>
                    candidate.environment === resource.environment &&
                    candidate.type === resource.type &&
                    candidate.name.toLowerCase() === resource.name.toLowerCase(),
            );
            if (existing) {
                for (const evidence of resource.evidence) {
                    if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
                }
            } else {
                node.azureResources.push({
                    ...resource,
                    evidence: [...resource.evidence],
                });
            }
        }
    }
}

function resourceMatches(text) {
    const normalizedText = String(text).toLowerCase();
    return RESOURCE_DEFINITIONS.filter((resource) =>
        resource.patterns.some((pattern) => normalizedText.includes(pattern)),
    );
}

function relationForKey(key, resourceId) {
    const upperKey = key.toUpperCase();
    if (resourceId === "azure-service-bus") return "publishes / consumes";
    if (resourceId === "application-insights") return "emits telemetry";
    if (resourceId === "azure-key-vault") return "reads secrets";
    if (resourceId === "azure-app-configuration") return "reads configuration";
    if (resourceId === "azure-blob-storage") return "stores / reads files";
    if (["mongodb", "sql-server", "redis", "databricks"].includes(resourceId)) {
        return upperKey.includes("CACHE") ? "caches data" : "reads / writes data";
    }
    if (upperKey.includes("AUTH")) return "authenticates via";
    return "calls";
}

function safeEndpoint(value) {
    const match = String(value).match(/https?:\/\/[^\s;]+/i);
    if (!match) {
        return undefined;
    }
    try {
        const parsed = new URL(match[0]);
        parsed.username = "";
        parsed.password = "";
        parsed.search = "";
        parsed.hash = "";
        return `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    } catch {
        return undefined;
    }
}

function isSensitiveKey(key) {
    return /(SECRET|PASSWORD|TOKEN|API_?KEY|ACCESS_?KEY|CONNECTION_?STRING|PRIVATE_?KEY|CLIENT_?SECRET)/i.test(
        key,
    );
}

function findInternalTarget(components, sourceId, key, value) {
    const haystack = normalized(`${key} ${value}`);
    const source = components.find((component) => component.id === sourceId);
    const sourceScore = source
        ? Math.max(
              0,
              ...componentAliases(source).map((alias) => (haystack.includes(alias) ? alias.length : 0)),
          )
        : 0;
    const candidates = components
        .filter((component) => component.id !== sourceId)
        .map((component) => ({
            component,
            score: Math.max(
                0,
                ...componentAliases(component).map((alias) => (haystack.includes(alias) ? alias.length : 0)),
            ),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score);
    return candidates[0]?.score > sourceScore ? candidates[0].component : undefined;
}

function processReference({
    component,
    key,
    value,
    evidence,
    components,
    nodeMap,
    edgeMap,
}) {
    const endpoint = isSensitiveKey(key) ? undefined : safeEndpoint(value);
    if (endpoint && !component.endpoints.some((item) => item.url === endpoint)) {
        component.endpoints.push({ name: key, url: endpoint, evidence });
    }

    const internalTarget = findInternalTarget(components, component.id, key, endpoint ?? value);
    if (internalTarget) {
        addEdge(
            edgeMap,
            component.id,
            internalTarget.id,
            /AUTH/i.test(key) ? "authenticates via" : "calls",
            `${evidence} (${key})`,
            "inferred",
        );
    }

    for (const resource of resourceMatches(`${key} ${endpoint ?? ""}`)) {
        const resourceNode = ensureResourceNode(nodeMap, resource);
        addEdge(
            edgeMap,
            component.id,
            resourceNode,
            relationForKey(key, resource.id),
            `${evidence} (${key})`,
            "detected",
        );
    }

    if (endpoint && !internalTarget && resourceMatches(endpoint).length === 0) {
        const hostname = new URL(endpoint).hostname.toLowerCase();
        const id = `external:${hostname}`;
        if (!nodeMap.has(id)) {
            nodeMap.set(id, {
                id,
                name: hostname,
                displayName: hostname,
                description: "External endpoint",
                category: "external",
                kind: "External system",
                technologies: [],
                manifests: [],
                pipelines: [],
                endpoints: [{ name: "Endpoint", url: endpoint, evidence }],
                virtual: true,
            });
        }
        const externalNode = nodeMap.get(id);
        if (
            !externalNode.endpoints.some(
                (candidate) => candidate.url === endpoint && candidate.evidence === evidence,
            )
        ) {
            externalNode.endpoints.push({ name: "Endpoint", url: endpoint, evidence });
        }
        addEdge(edgeMap, component.id, id, "calls", `${evidence} (${key})`, "detected");
    }
}

async function analyzeEnvironment(component, components, nodeMap, edgeMap) {
    for (const file of component.envFiles) {
        const content = await readText(file.absolute, `${component.path}/${file.relative}`);
        for (const line of content.split(/\r?\n/)) {
            const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
            if (!match) continue;
            processReference({
                component,
                key: match[1],
                value: match[2],
                evidence: `${component.path}/${file.relative}`,
                components,
                nodeMap,
                edgeMap,
            });
        }
    }
}

async function analyzeCompose(component, components, nodeMap, edgeMap) {
    for (const file of component.composeFiles) {
        const content = await readText(file.absolute, `${component.path}/${file.relative}`);
        const evidence = `${component.path}/${file.relative}`;
        for (const line of content.split(/\r?\n/)) {
            const envMatch = line.match(/^\s{4,}(?:-\s*)?([A-Z][A-Z0-9_]*)\s*[:=]\s*(.+)$/);
            if (envMatch) {
                processReference({
                    component,
                    key: envMatch[1],
                    value: envMatch[2],
                    evidence,
                    components,
                    nodeMap,
                    edgeMap,
                });
            }
        }

        const dependencyBlock = content.match(/depends_on:\s*\n((?:\s{6,}.+\n?)*)/i)?.[1] ?? "";
        for (const match of dependencyBlock.matchAll(/^\s+(?:-\s*)?([a-zA-Z0-9_-]+):?/gm)) {
            const dependencyName = match[1];
            const internalTarget = findInternalTarget(
                components,
                component.id,
                dependencyName,
                dependencyName,
            );
            if (internalTarget) {
                addEdge(edgeMap, component.id, internalTarget.id, "depends on", evidence, "detected");
            }
            for (const resource of resourceMatches(dependencyName)) {
                addEdge(
                    edgeMap,
                    component.id,
                    ensureResourceNode(nodeMap, resource),
                    "depends on",
                    evidence,
                    "detected",
                );
            }
        }
    }
}

async function analyzePipelines(workspaceRoot, components, nodeMap, edgeMap) {
    const workflowFiles = [];
    for (const workflowRoot of WORKFLOW_ROOTS) {
        const workflowsPath = path.join(workspaceRoot, ...workflowRoot.split("/"));
        if (!(await exists(workflowsPath))) continue;
        const files = (await collectFiles(workflowsPath, 1)).filter((file) =>
            /\.ya?ml$/i.test(file.name),
        );
        workflowFiles.push(
            ...files.map((file) => ({
                ...file,
                workflowRoot,
            })),
        );
    }
    let pipelineNode;
    for (const file of workflowFiles) {
        const content = await readText(
            file.absolute,
            `${file.workflowRoot}/${file.relative}`,
        );
        const normalizedContent = normalized(content);
        const normalizedFileName = normalized(file.name);
        const pipelineRelation = /^(deploy|app-gateway|databricks|promote)/i.test(file.name)
            ? "deploys"
            : "validates";
        const explicitMatches = components.filter((component) =>
            normalizedContent.includes(normalized(component.path)),
        );
        const fallbackMatches = components
            .map((component) => ({
                component,
                score: Math.max(
                    0,
                    ...componentAliases(component).map((alias) =>
                        alias.length >= 5 && normalizedFileName.includes(alias) ? alias.length : 0,
                    ),
                ),
            }))
            .filter((candidate) => candidate.score > 0);
        const bestFallbackScore = Math.max(0, ...fallbackMatches.map((candidate) => candidate.score));
        const matches =
            explicitMatches.length > 0
                ? explicitMatches
                : fallbackMatches
                      .filter((candidate) => candidate.score === bestFallbackScore)
                      .map((candidate) => candidate.component);
        const deploymentResourceGroups = new Map();
        for (const match of content.matchAll(
            /--resource-group\s+["']?((?!\$)[A-Za-z0-9._-]+)["']?/gi,
        )) {
            const environment = /(?:^|-)dev$/i.test(match[1])
                ? "Development"
                : /(?:^|-)uat$/i.test(match[1])
                  ? "UAT"
                  : /(?:^|-)prod$/i.test(match[1])
                    ? "Production"
                    : undefined;
            if (environment) deploymentResourceGroups.set(environment, match[1]);
        }
        for (const match of content.matchAll(
            /azureSubscription:\s*["']?(az-rg-[A-Za-z0-9._-]+)["']?/gi,
        )) {
            const environment = /(?:^|-)dev$/i.test(match[1])
                ? "Development"
                : /(?:^|-)uat$/i.test(match[1])
                  ? "UAT"
                  : /(?:^|-)prod$/i.test(match[1])
                    ? "Production"
                    : undefined;
            if (environment && !deploymentResourceGroups.has(environment)) {
                deploymentResourceGroups.set(environment, match[1]);
            }
        }
        for (const component of matches) {
            const pipelinePath = `${file.workflowRoot}/${file.relative}`;
            if (!component.pipelines.includes(pipelinePath)) component.pipelines.push(pipelinePath);
            for (const [environment, resourceGroupName] of deploymentResourceGroups) {
                addComponentAzureResource(
                    component,
                    "Resource Group",
                    resourceGroupName,
                    environment,
                    pipelinePath,
                );
            }
            if (!pipelineNode) {
                pipelineNode = {
                    id: "delivery:azure-devops",
                    name: "Azure DevOps",
                    displayName: "Azure DevOps",
                    description: "Build, validation, and deployment workflows",
                    category: "delivery",
                    kind: "CI/CD",
                    technologies: ["Azure Pipelines"],
                    manifests: [],
                    pipelines: [],
                    endpoints: [],
                    virtual: true,
                };
                nodeMap.set(pipelineNode.id, pipelineNode);
            }
            if (!pipelineNode.pipelines.includes(pipelinePath)) pipelineNode.pipelines.push(pipelinePath);
            addEdge(
                edgeMap,
                pipelineNode.id,
                component.id,
                pipelineRelation,
                pipelinePath,
                "detected",
            );
        }
    }
}

function analyzePackageDependencies(components, nodeMap, edgeMap) {
    const packageOwners = new Map(
        components
            .filter((component) => component.packageName)
            .map((component) => [component.packageName, component]),
    );
    for (const component of components) {
        for (const dependency of Object.keys(component.dependencies)) {
            const internalTarget = packageOwners.get(dependency);
            if (internalTarget && internalTarget.id !== component.id) {
                addEdge(
                    edgeMap,
                    component.id,
                    internalTarget.id,
                    "package dependency",
                    `${component.path}/package.json (${dependency})`,
                    "detected",
                );
            }
            for (const resource of resourceMatches(dependency)) {
                addEdge(
                    edgeMap,
                    component.id,
                    ensureResourceNode(nodeMap, resource),
                    relationForKey(dependency, resource.id),
                    `${component.path}/package.json (${dependency})`,
                    "detected",
                );
            }
        }
    }
}

async function discoverDefinitions(workspaceRoot, includeArchived) {
    const definitions = [];
    const definitionPaths = new Set();
    for (const root of COMPONENT_ROOTS) {
        const rootPath = path.join(workspaceRoot, root.path);
        for (const child of await listDirectories(rootPath, root.path)) {
            if (
                ARCHITECTURE_PROFILE.libraryRoots.some(
                    (libraryRoot) => libraryRoot.path === `${root.path}/${child}`,
                )
            ) {
                continue;
            }
            const definition = {
                path: `${root.path}/${child}`,
                category: root.category,
                kind: root.kind,
            };
            definitions.push(definition);
            definitionPaths.add(definition.path);
        }
    }
    for (const libraryRoot of ARCHITECTURE_PROFILE.libraryRoots) {
        const rootPath = path.join(workspaceRoot, libraryRoot.path);
        for (const child of await listDirectories(rootPath, libraryRoot.path)) {
            const definition = {
                path: `${libraryRoot.path}/${child}`,
                category: libraryRoot.category,
                kind: libraryRoot.kind,
            };
            definitions.push(definition);
            definitionPaths.add(definition.path);
        }
    }
    for (const component of STANDALONE_COMPONENTS) {
        const componentPath = path.join(workspaceRoot, ...component.path.split("/"));
        if (!(await exists(componentPath))) continue;
        if (component.path === "documentation" && (await collectFiles(componentPath)).length === 0) {
            continue;
        }
        definitions.push(component);
        definitionPaths.add(component.path);
    }
    if (ARCHITECTURE_PROFILE.autoDiscovery?.enabled) {
        const configuredTopLevelDirectories = new Set([
            ...COMPONENT_ROOTS.map((root) => root.path.split("/")[0]),
            ...STANDALONE_COMPONENTS.map((component) => component.path.split("/")[0]),
            ...ARCHIVE_ROOTS.map((root) => root.path.split("/")[0]),
        ]);
        for (const child of await listDirectories(workspaceRoot, "repository root")) {
            if (child.startsWith(".") || configuredTopLevelDirectories.has(child)) continue;
            const files = await collectFiles(path.join(workspaceRoot, child), 1);
            const hasMarker = files.some((file) =>
                ARCHITECTURE_PROFILE.autoDiscovery.markers.some((marker) =>
                    marker.startsWith("*.")
                        ? file.name.endsWith(marker.slice(1))
                        : file.name.toLowerCase() === marker.toLowerCase(),
                ),
            );
            if (!hasMarker) continue;
            const categoryPattern = ARCHITECTURE_PROFILE.autoDiscovery.categoryPatterns.find((entry) =>
                entry.pattern.test(child),
            );
            if (!categoryPattern) continue;
            const definition = {
                path: child,
                category: categoryPattern.category,
                kind: categoryPattern.kind,
            };
            if (!definitionPaths.has(definition.path)) {
                definitions.push(definition);
                definitionPaths.add(definition.path);
            }
        }
    }
    if (includeArchived) {
        for (const root of ARCHIVE_ROOTS) {
            for (const child of await listDirectories(
                path.join(workspaceRoot, ...root.path.split("/")),
                root.path,
            )) {
                const definition = {
                    path: `${root.path}/${child}`,
                    category: root.category,
                    kind: root.kind,
                    archived: true,
                };
                definitions.push(definition);
                definitionPaths.add(definition.path);
            }
        }
    }
    return definitions;
}

function publicNode(component) {
    const { dependencies, files, composeFiles, envFiles, packageName, ...node } = component;
    return node;
}

function sortedUnique(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableNode(node) {
    return {
        ...node,
        technologies: sortedUnique(node.technologies ?? []),
        manifests: sortedUnique(node.manifests ?? []),
        pipelines: sortedUnique(node.pipelines ?? []),
        endpoints: [...(node.endpoints ?? [])]
            .map((endpoint) => ({ ...endpoint }))
            .sort((left, right) =>
                `${left.name}:${left.url}:${left.evidence}`.localeCompare(
                    `${right.name}:${right.url}:${right.evidence}`,
                ),
            ),
        azureResources: [...(node.azureResources ?? [])]
            .map((resource) => ({
                ...resource,
                evidence: sortedUnique(resource.evidence ?? []),
            }))
            .sort((left, right) =>
                `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`),
            ),
    };
}

export async function scanRepository(workspaceRoot, options = {}) {
    const startedAt = Date.now();
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    if (!(await exists(resolvedWorkspaceRoot))) {
        throw new Error(`Repository root does not exist: ${workspaceRoot}`);
    }
    const includeArchived = options.includeArchived === true;
    const definitions = await discoverDefinitions(resolvedWorkspaceRoot, includeArchived);
    const components = await Promise.all(
        definitions.map((definition) => buildComponent(resolvedWorkspaceRoot, definition)),
    );
    const nodeMap = new Map(components.map((component) => [component.id, component]));
    const edgeMap = new Map();

    attachAzureResourcesToPlatformNodes(components, nodeMap);
    analyzePackageDependencies(components, nodeMap, edgeMap);
    await Promise.all(
        components.map(async (component) => {
            await analyzeEnvironment(component, components, nodeMap, edgeMap);
            await analyzeCompose(component, components, nodeMap, edgeMap);
        }),
    );
    await analyzePipelines(resolvedWorkspaceRoot, components, nodeMap, edgeMap);

    const nodes = [...nodeMap.values()]
        .map(publicNode)
        .map(stableNode)
        .sort((left, right) =>
            `${left.category}:${left.displayName}:${left.id}`.localeCompare(
                `${right.category}:${right.displayName}:${right.id}`,
            ),
        );
    const edges = [...edgeMap.values()]
        .map(({ id: _id, ...edge }) => ({
            ...edge,
            evidence: sortedUnique(edge.evidence ?? []),
        }))
        .sort((left, right) =>
            `${left.source}:${left.target}:${left.relation}:${left.confidence}`.localeCompare(
                `${right.source}:${right.target}:${right.relation}:${right.confidence}`,
            ),
        )
        .map((edge, index) => ({ id: `edge:${index + 1}`, ...edge }));
    const componentCount = nodes.filter((node) => !node.virtual).length;
    const categoryCounts = Object.fromEntries(
        [...new Set(nodes.map((node) => node.category))]
            .sort((left, right) => left.localeCompare(right))
            .map((category) => [
                category,
                nodes.filter((node) => node.category === category).length,
            ]),
    );

    return {
        schemaVersion: GRAPH_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        workspaceName: path.basename(resolvedWorkspaceRoot),
        options: {
            includeArchived,
            profileVersion: ARCHITECTURE_PROFILE.version,
        },
        summary: {
            components: componentCount,
            systems: nodes.length,
            relationships: edges.length,
            categories: categoryCounts,
        },
        nodes,
        edges,
    };
}

export function searchGraph(graph, query) {
    const needle = normalized(query);
    if (!needle) return [];
    return graph.nodes
        .map((node) => {
            const fields = [
                node.displayName,
                node.name,
                node.path,
                node.kind,
                node.description,
                ...(node.technologies ?? []),
            ];
            const score = Math.max(
                ...fields.map((field) => {
                    const value = normalized(field);
                    if (!value) return 0;
                    if (value === needle) return 100;
                    if (value.startsWith(needle)) return 75;
                    return value.includes(needle) ? 50 : 0;
                }),
            );
            return { node, score };
        })
        .filter((result) => result.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 20)
        .map(({ node }) => node);
}
