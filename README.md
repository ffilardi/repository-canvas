# Repository Canvas

Repository Canvas turns repository metadata into an interactive architecture map. It discovers applications, services, infrastructure, delivery workflows, dependencies, external systems, and environment-specific Azure resources, then renders the result as either:

- a self-contained HTML snapshot that opens without a server; or
- a project-scoped GitHub Copilot canvas that scans the current worktree.

The scanner and static generator use only Node.js built-in modules. The generated page contains its CSS, JavaScript, and graph data inline and makes no runtime network requests.

## Features

- Searchable architecture graph with category filters and component details
- Logical service and deployed-resource views
- Development, UAT, and Production resource selection
- Application-focused highlighting of related nodes and relationships
- Evidence paths for detected and inferred relationships
- Optional archived-application discovery
- High-resolution PNG export in light and dark themes
- Deterministic graph validation and snapshot freshness checks
- GitHub Actions and Azure Pipelines refresh workflows
- Configurable repository discovery through one architecture profile

## How it works

```text
Repository files
      |
      v
  scanner.mjs --------> graph-contract.mjs
      |                         |
      |                         v
      +------------------> renderer.mjs
                                |
                     +----------+----------+
                     |                     |
                     v                     v
             Static index.html     Copilot canvas
```

The scanner reads repository declarations rather than querying deployed infrastructure. It currently recognizes sources such as:

- application and package manifests;
- sample environment files such as `.env.example`, `.env.sample`, and `.env.template`;
- Docker Compose definitions;
- GraphQL schemas;
- Bicep files and environment parameter files;
- GitHub Actions and Azure Pipelines workflows; and
- configurable technology, resource, path, and alias patterns.

## Requirements

- Git repository checkout
- Node.js 22 or later
- A Chromium-based browser for the standalone page
- Bash or PowerShell to use the provided refresh wrappers

No package installation is required for the scanner, tests, renderer, or static generator.

## Quick start

Repository Canvas is designed to live inside the repository it documents.

1. Copy these directories into the root of the target repository:

   ```text
   .github/extensions/repository-architecture/
   documentation/repository-architecture/
   ```

2. Edit `.github/extensions/repository-architecture/architecture-profile.mjs` to match the target repository's layout and conventions.

3. Generate the standalone architecture page from the target repository root:

   ```bash
   bash documentation/repository-architecture/refresh.sh
   ```

   On Windows PowerShell:

   ```powershell
   .\documentation\repository-architecture\refresh.ps1
   ```

4. Open `documentation/repository-architecture/index.html` in a browser.

   ```bash
   open documentation/repository-architecture/index.html
   ```

The refresh wrapper runs the complete test suite before writing the snapshot. If scanning or validation fails, the previous generated page is preserved.

## Configure discovery

Most repository-specific behavior is defined in [`architecture-profile.mjs`](.github/extensions/repository-architecture/architecture-profile.mjs):

| Setting | Purpose |
| --- | --- |
| `componentRoots` | Directories containing applications and services |
| `standaloneComponents` | Projects represented by a fixed path |
| `libraryRoots` | Shared libraries that should not appear as applications |
| `archiveRoots` | Archived components excluded by default |
| `autoDiscovery` | Manifest and naming rules for top-level components |
| `workflowRoots` | GitHub Actions and Azure Pipelines locations |
| `resourceDefinitions` | External, data, and platform dependency patterns |
| `technologyRules` | Package-to-technology mappings |
| `azureResourceParameterRules` | Bicep parameter-to-resource mappings |
| `displayNames` and `knownAliases` | Labels and internal endpoint matching |
| `deploymentEnvironments` | Environment suffixes recognized in parameter files |

Increment the profile `version` when changing its contract. Add a minimal fixture and test whenever a new repository convention is introduced.

## Validate changes

Run all tests and confirm that the committed snapshot matches the current repository:

```bash
bash documentation/repository-architecture/refresh.sh --check
```

```powershell
.\documentation\repository-architecture\refresh.ps1 -Check
```

To run only the dependency-free Node.js test suite:

```bash
node --test --test-concurrency=1 .github/extensions/repository-architecture/test/*.test.mjs
```

## Automation

The included [GitHub Actions workflow](.github/workflows/refresh-repository-architecture.yml) checks the snapshot after changes land on `master`. When the architecture is stale, it regenerates `index.html`, pushes an automation branch, and opens a pull request.

An equivalent [Azure Pipelines workflow](.azdevops/workflows/refresh-repository-architecture.yml) is also included. Adapt the branch name, paths, permissions, and pull-request policy to your repository before enabling either workflow.

For GitHub Actions, the workflow requires `contents: write` and `pull-requests: write`. The repository's Actions settings must also permit GitHub Actions to create pull requests.

## Copilot canvas

[`extension.mjs`](.github/extensions/repository-architecture/extension.mjs) defines the project-scoped **Repository architecture** canvas. In a compatible GitHub Copilot extension host, it provides a live view of the current worktree and these agent actions:

| Action | Description |
| --- | --- |
| `refresh` | Rescan the repository and update the open graph |
| `get_summary` | Return component and relationship coverage counts |
| `find_component` | Search by name, path, kind, or technology |
| `get_component` | Return a component, its relationships, and evidence |

The live canvas depends on `@github/copilot-sdk/extension`, which is supplied by the compatible extension runtime. The standalone generator does not require that package.

## Security and limitations

- The graph reflects repository declarations, not live cloud inventory.
- Inferred relationships are hypotheses. Inspect their evidence paths before treating them as authoritative.
- Credential-like environment values are rejected by the graph contract and are not intentionally included in graph output.
- The generated page can still expose architecture names, paths, endpoints, and infrastructure metadata. Protect it with the same access controls as the source repository.
- The standalone page has no runtime network capability; PNG export is performed entirely in the browser.

## Project structure

```text
.
|-- .github/
|   |-- extensions/repository-architecture/  # Scanner, renderer, canvas, and tests
|   `-- workflows/                           # GitHub Actions refresh workflow
|-- .azdevops/workflows/                     # Azure Pipelines refresh workflow
`-- documentation/repository-architecture/   # Refresh scripts, guide, and generated page
```

See the [extension guide](.github/extensions/repository-architecture/README.md) for scanner and canvas details, and the [snapshot guide](documentation/repository-architecture/README.md) for operation and troubleshooting.

## Contributing

Keep changes focused and include fixture coverage for new discovery behavior. Before opening a pull request:

1. Run the test suite.
2. Regenerate `documentation/repository-architecture/index.html` when graph inputs or rendering behavior change.
3. Run the freshness check.
4. Review the generated file for unexpected repository metadata.
