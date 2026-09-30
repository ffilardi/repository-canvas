import assert from "node:assert/strict";
import test from "node:test";
import { scanRepository } from "../scanner.mjs";
import { validateGraph } from "../graph-contract.mjs";
import { createGenericFixtureRepository } from "./helpers.mjs";

test("profile-driven scanner supports a generic application repository", async () => {
    const root = await createGenericFixtureRepository();
    const graph = validateGraph(await scanRepository(root));
    const storefront = graph.nodes.find((node) => node.id === "component:frontend/storefront");
    const orders = graph.nodes.find((node) => node.id === "component:backend/orders");
    const ordersInfrastructure = graph.nodes.find(
        (node) => node.id === "component:infrastructure/orders",
    );
    const autoDiscoveredApi = graph.nodes.find(
        (node) => node.id === "component:orders-api",
    );
    const ordersResource = ordersInfrastructure?.azureResources.find(
        (resource) => resource.name === "orders-dev",
    );

    assert(storefront);
    assert(orders);
    assert.equal(storefront.kind, "React frontend");
    assert.equal(orders.kind, "Backend service");
    assert(orders.technologies.includes("Azure Service Bus"));
    assert(ordersInfrastructure);
    assert.equal(autoDiscoveredApi?.category, "backend");
    assert(ordersResource);
    assert.equal(ordersResource.environment, "Development");
    assert(
        graph.edges.some(
            (edge) =>
                edge.source === storefront.id &&
                edge.target === autoDiscoveredApi.id,
        ),
    );
    assert(
        graph.edges.some(
            (edge) =>
                edge.source === "delivery:azure-devops" &&
                edge.target === orders.id &&
                edge.relation === "deploys",
        ),
    );
    assert(orders.pipelines.includes(".github/workflows/deploy-orders.yml"));
});
