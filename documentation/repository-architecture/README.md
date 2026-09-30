# Repository architecture snapshot

The generated repository architecture page provides a searchable, interactive view of applications, APIs, infrastructure, dependencies, connections, data flows, and declared Azure resource names for Dev, UAT, and Production.

## Open the page

Open [`index.html`](index.html) directly from a repository checkout. No build, server, Copilot installation, Azure access, or credentials are required.

```powershell
Start-Process .\documentation\repository-architecture\index.html
```

```bash
open documentation/repository-architecture/index.html
```

```bash
xdg-open documentation/repository-architecture/index.html
```

The page is supported in the organization-supported Chromium browser. It contains all CSS, JavaScript, and graph data inline and makes no runtime network requests.

## Snapshot and live canvas

The committed page is a snapshot of the repository at generation time. Its header shows the graph schema version, stable input fingerprint, and **Graph input revision**. The revision can precede the commit containing the generated page; use the freshness check below as the authoritative validation.

The Copilot **Repository architecture** canvas uses the same scanner and renderer but scans the current worktree live. Its **Refresh** action is not available in the standalone snapshot. Both views exclude archived applications initially; the archived toggle switches to a second embedded dataset in the standalone page and performs a live rescan in the canvas.

The left panel lists repository applications. Select one to highlight the boxes, relationship lines, and arrowheads attributable to it; unrelated elements are faded. Select **All applications** to clear the focus. The selection remains active when switching between service and resource views or changing resource environments.

Use **Show resources** to switch from the logical service map to the deployed-resource map. The resource view displays actual Azure resource names and external endpoint names, and links deployed applications to the resources they use. Select **Dev**, **UAT**, or **Prod** to change the displayed environment. Resource groups are intentionally omitted from the graph; select a resource to see its resolved deployment resource group in the detail panel. Switch back with **Show services**.

Use **Export PNG** to download a shareable, high-resolution diagram:

- With an application selected, the PNG contains only its highlighted elements and attributable relationship arrows in a compact layout.
- With **All applications** selected, the PNG contains the full current service/resource graph for the enabled category filters.
- The image title uses the application name when focused and identifies the selected resource environment.
- The export preserves the currently displayed light/dark theme and color pattern.
- Search text does not remove elements from exports; use category filters or application focus to control export scope.

## Regenerate

Run the appropriate refresh script from the repository root. Both scripts run the complete architecture test suite first, then call the generator under `.github/extensions/repository-architecture/` with the required paths and arguments. They stop without refreshing the page if a test fails.

```powershell
.\documentation\repository-architecture\refresh.ps1
```

```bash
bash documentation/repository-architecture/refresh.sh
```

Review and commit the generated `index.html` with any scanner, renderer, application, infrastructure, or documentation changes that affect the graph.

To run the tests and verify freshness without modifying the checkout:

```powershell
.\documentation\repository-architecture\refresh.ps1 -Check
```

```bash
bash documentation/repository-architecture/refresh.sh --check
```

Run the dependency-free tests with Node.js 22 or later:

```powershell
$tests = Get-ChildItem .github\extensions\repository-architecture\test\*.test.mjs |
  Select-Object -ExpandProperty FullName
node --test --test-concurrency=1 $tests
```

## Data sources and limitations

The scanner uses package manifests, sample environment files, Docker Compose files, GraphQL schemas, Bicep production parameters, infrastructure markers, and Azure DevOps workflows. Relationships may be detected directly or inferred from names and endpoints; select a node and inspect the evidence paths before treating an inferred relationship as authoritative.

Azure resource names are declarations from environment-specific repository IaC and configuration, not live Azure inventory. A resource may be absent from an environment view when that environment has no corresponding parameter file or resolvable resource name. Sensitive environment values and credential-like content are rejected by the graph contract. The generated file contains repository-derived architecture information and must remain protected by repository and filesystem access controls.

## Porting the canvas

The live canvas can be ported as a project-scoped extension by copying
`.github/extensions/repository-architecture/` into another repository. The
renderer and graph contract are reusable, while
`.github/extensions/repository-architecture/architecture-profile.mjs` is the
repository-specific adapter. Update its component roots, archive roots,
workflow roots, environment suffixes, dependency/resource patterns, aliases,
and Azure parameter mappings to match the destination repository before
running the refresh script. The generated HTML must be regenerated from the
destination repository; it should not be copied as a static source of truth.

The default adapter supports this repository's `frontend/`, `backend/`, and
`infrastructure/` layout plus `.azdevops/workflows` and `.github/workflows`.
Repositories with different conventions can use the same UI and graph schema
after changing the profile. Resource types that are not represented by the
default Azure mappings may require an additional profile mapping so their
shared platform nodes and resource-view links are visible.

## Troubleshooting

- **The page looks stale:** run the `--check` command, regenerate, and review the diff.
- **Generation fails:** correct the reported malformed or unsafe input. The previous generated page is preserved.
- **The page does not open:** use the supported Chromium browser and open the file directly through `file://`.
- **A component or relationship is missing:** update `scanner.mjs` and add a minimal fixture that demonstrates the repository convention.
- **The graph schema is incompatible:** regenerate with the current generator. Schema version changes require corresponding renderer and validator updates.

## Ownership

- **Technical owner:** Digital Innovation engineering team
- **Documentation owner:** Digital Innovation engineering team

The graph contract is currently schema version `2`. Backward-incompatible changes require a schema version increment and an actionable standalone-page compatibility error.
