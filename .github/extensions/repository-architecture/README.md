# Repository architecture canvas

This project-scoped Copilot canvas builds an interactive architecture map from the repository. Open the **Repository architecture** canvas to search, filter, and inspect applications, APIs, infrastructure, data systems, delivery workflows, dependencies, and data-flow evidence.

- Select an application in the left panel to highlight its related boxes, relationship lines, and arrows.
- Use **Export PNG** to download the current diagram. Application focus exports only highlighted elements; no focus exports the full enabled-category graph.
- Use **Show resources** to replace service boxes with actual Azure resource names and external endpoints.
- In resource view, select **Dev**, **UAT**, or **Prod** to inspect that environment.
- Resource groups are shown in the selected resource's detail panel rather than as graph boxes.
- Use **Include archived** to toggle applications under `archive/`.

For the committed, server-free snapshot and regeneration workflow, see [`documentation/repository-architecture/README.md`](../../../documentation/repository-architecture/README.md).

## Discovery sources

- Application and package manifests
- Sample environment files (`.env.sample`, `.env.example`, and `.env.template`)
- Docker Compose services and dependencies
- GraphQL schemas
- Infrastructure and platform markers
- Dev, UAT, and Production Bicep parameter files and computed deployment names
- Azure DevOps workflows

The application panel lists frontend applications, backend services, and the repository CMS. Application focus is ownership-aware in resource view, so shared infrastructure does not pull unrelated applications into the highlight. Relationships are labelled as detected or inferred and include the source file that produced the edge. Component details include environment-specific Azure resource names with their IaC evidence paths. Resource view links deployed applications to their attached Azure resources, referenced deployed resources, and external systems. Environment values that may contain credentials are not included in the graph. Archived applications are excluded by default and can be included through the canvas input or the `refresh` action.

PNG exports are generated entirely in the browser at high resolution. They preserve the displayed light/dark theme and category colors, include an application/view title, and do not require a server or network request.

## Porting to another repository

The canvas is portable as a project-scoped extension. Copy the entire
`.github/extensions/repository-architecture/` directory, including
`architecture-profile.mjs`, into the destination repository. The runtime
canvas, renderer, graph contract, resource view, application focus, PNG export,
and standalone generator are shared. `architecture-profile.mjs` is the
repository adapter. Increment its `version` when changing the profile
contract:

- `componentRoots`, `standaloneComponents`, and `archiveRoots` define where applications and supporting projects are discovered.
- `libraryRoots` identifies shared libraries that should not appear as standalone backend applications.
- `autoDiscovery` optionally detects top-level application folders from common manifest/IaC markers and name patterns.
- `workflowRoots` lists CI/CD workflow directories; both Azure DevOps and GitHub Actions are supported by default.
- `resourceDefinitions`, `technologyRules`, `technologyPathRules`, and `azureResourceParameterRules` describe dependency and IaC conventions.
- `displayNames` and `knownAliases` improve application labels and internal endpoint matching.
- `deploymentEnvironments` controls the environment suffixes recognized in parameter filenames.

The default profile preserves this repository's `frontend/`, `backend/`,
`infrastructure/`, and Azure naming conventions. For a destination repository
with different layout or IaC names, edit the profile before generating the
snapshot. Unsupported optional directories are skipped; malformed files and
credential-like values still fail loudly. New resource types should also be
added to `resourceNodeByAzureType` when they need a shared platform node in
resource view.

The destination repository must have Node.js 22 or later. After copying and
editing the profile, copy the refresh wrappers and documentation directory (or
adapt their paths), then run the test suite and refresh the standalone page.

## Agent actions

- `refresh` rescans the repository.
- `get_summary` returns coverage counts.
- `find_component` searches by name, path, kind, or technology.
- `get_component` returns a component, its relationships, and supporting evidence.

## Validate and regenerate

The refresh wrappers run these tests automatically before generating or checking the page.

```powershell
$tests = Get-ChildItem .github\extensions\repository-architecture\test\*.test.mjs |
  Select-Object -ExpandProperty FullName
node --test --test-concurrency=1 $tests

.\documentation\repository-architecture\refresh.ps1 -Check
# or
bash documentation/repository-architecture/refresh.sh --check
```
