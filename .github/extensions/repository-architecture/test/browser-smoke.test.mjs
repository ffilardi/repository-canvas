import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createStaticSite } from "../generate-static.mjs";
import { createFixtureRepository, outputPath } from "./helpers.mjs";

async function firstExisting(paths) {
    for (const candidate of paths) {
        if (!candidate) continue;
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Try the next supported browser location.
        }
    }
    return undefined;
}

const browserPath = await firstExisting([
    process.env.CHROME_PATH,
    process.platform === "win32"
        ? path.join(process.env.ProgramFiles ?? "", "Microsoft", "Edge", "Application", "msedge.exe")
        : undefined,
    process.platform === "win32"
        ? path.join(
              process.env["ProgramFiles(x86)"] ?? "",
              "Microsoft",
              "Edge",
              "Application",
              "msedge.exe",
          )
        : undefined,
    process.platform === "win32"
        ? path.join(process.env.ProgramFiles ?? "", "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]);

async function waitForFile(filePath, timeoutMs = 10_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            return await readFile(filePath, "utf8");
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForDownload(directory, expectedName, timeoutMs = 30_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const files = await readdir(directory).catch(() => []);
        if (files.includes(expectedName) && !files.includes(`${expectedName}.crdownload`)) {
            return readFile(path.join(directory, expectedName));
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for download ${expectedName}`);
}

class CdpClient {
    constructor(url) {
        this.socket = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
    }

    async open() {
        await new Promise((resolve, reject) => {
            this.socket.addEventListener("open", resolve, { once: true });
            this.socket.addEventListener("error", reject, { once: true });
        });
        this.socket.addEventListener("message", (event) => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(message.error.message));
                else pending.resolve(message.result);
                return;
            }
            for (const listener of this.listeners.get(message.method) ?? []) {
                listener(message.params);
            }
        });
    }

    send(method, params = {}) {
        const id = this.nextId;
        this.nextId += 1;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    on(method, listener) {
        const listeners = this.listeners.get(method) ?? [];
        listeners.push(listener);
        this.listeners.set(method, listeners);
    }

    waitFor(method, timeoutMs = 10_000) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
            this.on(method, (params) => {
                clearTimeout(timeout);
                resolve(params);
            });
        });
    }

    async evaluate(expression) {
        const result = await this.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text);
        }
        return result.result.value;
    }

    close() {
        this.socket.close();
    }
}

test(
    "standalone page works through file protocol without network requests",
    { skip: browserPath ? false : "No supported Chromium browser is installed" },
    async () => {
        const root = await createFixtureRepository();
        const profile = await mkdtemp(path.join(os.tmpdir(), "repository-architecture-browser-"));
        const downloadDirectory = path.join(profile, "downloads");
        let browser;
        let client;
        try {
            await createStaticSite({
                repoRoot: root,
                output: "documentation/repository-architecture/index.html",
                check: false,
            });
            browser = spawn(
                browserPath,
                [
                    "--headless=new",
                    "--disable-gpu",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--remote-debugging-port=0",
                    `--user-data-dir=${profile}`,
                    "about:blank",
                ],
                { stdio: "ignore", windowsHide: true },
            );
            const portFile = path.join(profile, "DevToolsActivePort");
            const [port] = (await waitForFile(portFile)).trim().split(/\r?\n/);
            const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
                response.json(),
            );
            const pageTarget = targets.find((target) => target.type === "page");
            if (!pageTarget) {
                throw new Error("Chromium did not expose a page debugging target.");
            }
            client = new CdpClient(pageTarget.webSocketDebuggerUrl);
            await client.open();
            await mkdir(downloadDirectory, { recursive: true });
            await Promise.all([
                client.send("Page.enable"),
                client.send("Runtime.enable"),
                client.send("Network.enable"),
                client.send("Log.enable"),
                client.send("Browser.setDownloadBehavior", {
                    behavior: "allow",
                    downloadPath: downloadDirectory,
                    eventsEnabled: true,
                }),
            ]);

            const browserErrors = [];
            const networkRequests = [];
            client.on("Runtime.exceptionThrown", (event) =>
                browserErrors.push(event.exceptionDetails?.text ?? "Runtime exception"),
            );
            client.on("Log.entryAdded", (event) => {
                if (event.entry?.level === "error") browserErrors.push(event.entry.text);
            });
            client.on("Network.requestWillBeSent", (event) => networkRequests.push(event.request.url));

            await client.send("Page.navigate", { url: pathToFileURL(outputPath(root)).href });
            const readyStarted = Date.now();
            while (
                !(await client.evaluate(
                    "location.protocol === 'file:' && document.readyState === 'complete' && Boolean(document.querySelector('h1'))",
                ))
            ) {
                if (Date.now() - readyStarted > 30_000) {
                    throw new Error("Timed out waiting for the standalone page to load.");
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }

            const initial = await client.evaluate(`({
              nodes: document.querySelectorAll('.node').length,
              refresh: Boolean(document.querySelector('#refresh')),
              title: document.querySelector('h1')?.textContent,
              schema: document.querySelector('#snapshot-schema')?.textContent,
              applications: [...document.querySelectorAll('[data-application-id]')].map(item => item.dataset.applicationId)
            })`);
            assert.equal(initial.title, "Repository architecture");
            assert.equal(initial.refresh, false);
            assert.equal(initial.schema, "2");
            assert(initial.nodes > 0);
            assert.deepEqual(initial.applications, [
                "component:backend/sample-api",
                "component:frontend/patient-web",
            ]);

            const serviceApplicationFocus = await client.evaluate(`(() => {
              const button = document.querySelector('[data-application-id="component:backend/sample-api"]');
              button.click();
              const activeButton = document.querySelector('[data-application-id="component:backend/sample-api"]');
              const result = {
                buttonActive: activeButton.getAttribute('aria-pressed'),
                relatedNodes: document.querySelectorAll('.node.related').length,
                dimNodes: document.querySelectorAll('.node.dim').length,
                activeEdges: document.querySelectorAll('.edge.active').length,
                activeArrows: [...document.querySelectorAll('.edge.active')].every(edge => edge.getAttribute('marker-end') === 'url(#arrow-active)')
              };
              activeButton.click();
              return result;
            })()`);
            assert.equal(serviceApplicationFocus.buttonActive, "true");
            assert(serviceApplicationFocus.relatedNodes > 1);
            assert(serviceApplicationFocus.dimNodes > 0);
            assert(serviceApplicationFocus.activeEdges > 0);
            assert.equal(serviceApplicationFocus.activeArrows, true);

            const interaction = await client.evaluate(`(() => {
              const before = Number(document.querySelector('#component-count').textContent);
              document.querySelector('#archive-toggle').click();
              const after = Number(document.querySelector('#component-count').textContent);
              const search = document.querySelector('#search');
              search.value = 'patient';
              search.dispatchEvent(new Event('input', { bubbles: true }));
              const matches = [...document.querySelectorAll('.node:not(.dim)')].length;
              const firstNode = document.querySelector('.node:not(.dim)');
              firstNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              const detailTitle = document.querySelector('#details h2')?.textContent;
              const relation = document.querySelector('.relation');
              relation?.click();
              const relatedTitle = document.querySelector('#details h2')?.textContent;
              const filter = document.querySelector('.filter');
              const filterLabel = filter.textContent;
              filter.click();
              const updatedFilter = [...document.querySelectorAll('.filter')].find(item => item.textContent === filterLabel);
              return {
                before,
                after,
                matches,
                detailTitle,
                relationNavigated: Boolean(relation && relatedTitle && relatedTitle !== detailTitle),
                filterDisabled: updatedFilter.classList.contains('off')
              };
            })()`);
            assert(interaction.after > interaction.before);
            assert(interaction.matches > 0);
            assert(interaction.detailTitle);
            assert.equal(interaction.relationNavigated, true);
            assert.equal(interaction.filterDisabled, true);

            const resourceView = await client.evaluate(`(() => {
              document.querySelector('#view-toggle').click();
              const applicationButton = document.querySelector('[data-application-id="component:backend/sample-api"]');
              applicationButton.click();
              const activeApplicationButton = document.querySelector('[data-application-id="component:backend/sample-api"]');
              const applicationHighlight = {
                buttonActive: activeApplicationButton.getAttribute('aria-pressed'),
                relatedNodes: document.querySelectorAll('.node.related').length,
                dimNodes: document.querySelectorAll('.node.dim').length,
                activeEdges: document.querySelectorAll('.edge.active').length,
                ownerEdges: [...document.querySelectorAll('.edge.active')].every(edge => edge.dataset.ownerIds.includes('component:backend/sample-api'))
              };
              const prodNames = [...document.querySelectorAll('.node .name')].map(item => item.textContent);
              const prodRelationships = Number(document.querySelector('#edge-count').textContent);
              const resourceGroupBoxes = [...document.querySelectorAll('.node')].filter(item => item.getAttribute('aria-label').endsWith(', Resource Group')).length;
              const sampleApi = [...document.querySelectorAll('.node')].find(item => item.getAttribute('aria-label').startsWith('ctapsampleapidiprd,'));
              sampleApi.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              const resourceDetails = document.querySelector('#details').textContent;
              const worker = [...document.querySelectorAll('.node')].find(item => item.getAttribute('aria-label').startsWith('ctapfixtureworkerdiprd,'));
              worker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              const workerDetails = document.querySelector('#details').textContent;
              const orphanWorker = [...document.querySelectorAll('.node')].find(item => item.getAttribute('aria-label').startsWith('ctaporphanworkerdiprd,'));
              orphanWorker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              const orphanWorkerDetails = document.querySelector('#details').textContent;
              const environmentVisible = !document.querySelector('#environment-control').hidden;
              const select = document.querySelector('#environment-select');
              select.value = 'Development';
              select.dispatchEvent(new Event('change', { bubbles: true }));
              const devNames = [...document.querySelectorAll('.node .name')].map(item => item.textContent);
              return {
                environmentVisible,
                resourceMode: document.querySelector('#view-toggle').getAttribute('aria-pressed'),
                applicationHighlight,
                prodRelationships,
                resourceGroupBoxes,
                showsResourceGroup: resourceDetails.includes('fixture-rg-prod'),
                infrastructureContainerHasEnvironment: workerDetails.includes('runs in') && workerDetails.includes('fixture-container-environment'),
                inferredContainerHasEnvironment: orphanWorkerDetails.includes('runs in') && orphanWorkerDetails.includes('fixture-container-environment'),
                hasProdResource: prodNames.some(name => name.includes('ctapsampleapidiprd')),
                hasProdExternal: prodNames.some(name => name.includes('vendor.example.com')),
                hasDevResource: devNames.some(name => name.includes('ctapsampleapididev')),
                hasDevExternal: devNames.some(name => name.includes('vendor-dev.example.com')),
                hidesProdInDev: !devNames.some(name => name.includes('ctapsampleapidiprd'))
              };
            })()`);
            assert.equal(resourceView.environmentVisible, true);
            assert.equal(resourceView.resourceMode, "true");
            assert.equal(resourceView.applicationHighlight.buttonActive, "true");
            assert(resourceView.applicationHighlight.relatedNodes > 1);
            assert(resourceView.applicationHighlight.dimNodes > 0);
            assert(resourceView.applicationHighlight.activeEdges > 0);
            assert.equal(resourceView.applicationHighlight.ownerEdges, true);
            assert(resourceView.prodRelationships > 0);
            assert.equal(resourceView.resourceGroupBoxes, 0);
            assert.equal(resourceView.showsResourceGroup, true);
            assert.equal(resourceView.infrastructureContainerHasEnvironment, true);
            assert.equal(resourceView.inferredContainerHasEnvironment, true);
            assert.equal(resourceView.hasProdResource, true);
            assert.equal(resourceView.hasProdExternal, true);
            assert.equal(resourceView.hasDevResource, true);
            assert.equal(resourceView.hasDevExternal, true);
            assert.equal(resourceView.hidesProdInDev, true);

            await client.evaluate(`document.querySelector('#export-png').click(); true`);
            const focusedPng = await waitForDownload(
                downloadDirectory,
                "sample-api-development-resources.png",
            );
            assert.deepEqual([...focusedPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
            assert(focusedPng.readUInt32BE(16) > 0);
            assert(focusedPng.readUInt32BE(20) > 0);
            assert(focusedPng.length > 1_000);
            const focusedExport = await client.evaluate(`({
              filename: document.querySelector('#export-png').dataset.lastExportFilename,
              title: document.querySelector('#export-png').dataset.lastExportTitle,
              subtitle: document.querySelector('#export-png').dataset.lastExportSubtitle,
              nodeIds: document.querySelector('#export-png').dataset.lastExportNodeIds.split(','),
              edgeCount: Number(document.querySelector('#export-png').dataset.lastExportEdgeCount),
              status: document.querySelector('#export-status').textContent
            })`);
            assert.equal(focusedExport.filename, "sample-api-development-resources.png");
            assert.equal(focusedExport.title, "Sample Api architecture");
            assert.match(focusedExport.subtitle, /^Development Azure resources/);
            assert(
                focusedExport.nodeIds.some((id) =>
                    id.includes("resource-instance:Development:Container App:ctapsampleapididev"),
                ),
            );
            assert(!focusedExport.nodeIds.some((id) => id.includes("ctaporphanworkerdiprd")));
            assert(focusedExport.edgeCount > 0);
            assert.match(focusedExport.status, /Downloaded sample-api-development-resources\.png/);

            const fullExportExpectation = await client.evaluate(`(() => {
              document.querySelector('.application-button.active[data-application-id]').click();
              document.querySelector('#view-toggle').click();
              const nodeCount = document.querySelectorAll('.node').length;
              document.querySelector('#export-png').click();
              return { nodeCount };
            })()`);
            const fullPng = await waitForDownload(
                downloadDirectory,
                "repository-architecture-services.png",
            );
            assert.deepEqual([...fullPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
            assert(fullPng.length > focusedPng.length);
            const fullExport = await client.evaluate(`({
              filename: document.querySelector('#export-png').dataset.lastExportFilename,
              nodeIds: document.querySelector('#export-png').dataset.lastExportNodeIds.split(',')
            })`);
            assert.equal(fullExport.filename, "repository-architecture-services.png");
            assert.equal(fullExport.nodeIds.length, fullExportExpectation.nodeCount);

            await client.send("Emulation.setDeviceMetricsOverride", {
                width: 560,
                height: 800,
                deviceScaleFactor: 1,
                mobile: false,
            });
            assert.match(
                await client.evaluate("getComputedStyle(document.querySelector('main')).gridTemplateColumns"),
                /^\d+(?:\.\d+)?px$/,
            );

            assert.deepEqual(browserErrors, []);
            assert.deepEqual(
                networkRequests.filter((url) => /^https?:/i.test(url)),
                [],
            );
        } finally {
            client?.close();
            if (browser && !browser.killed) {
                const exited = new Promise((resolve) => browser.once("exit", resolve));
                browser.kill();
                await exited;
            }
            await rm(root, { recursive: true, force: true });
            await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    },
);
