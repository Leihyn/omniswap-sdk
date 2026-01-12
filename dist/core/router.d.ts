import { SwapIntent, Route } from '../types';
import { AdapterRegistry } from '../adapters';
export declare class RouteOptimizer {
    private adapters;
    private liquidityGraph;
    constructor(adapters: AdapterRegistry);
    findRoutes(intent: SwapIntent): Promise<Route[]>;
    findPrivateRoute(intent: SwapIntent): Promise<Route>;
    private buildLiquidityGraph;
    private addDirectRoute;
    private addHubRoute;
    private addIBCRoutes;
    private getDirectEdges;
    private getIBCEdges;
    private addEdge;
    private findKShortestPaths;
    private simulateRoute;
    private calculateRouteScore;
    private calculateSlippageRisk;
    private calculateLiquidityDepth;
    private calculatePrivacyScore;
    private nodeKey;
    private createAsset;
    private isCosmosChain;
    private isEVMChain;
    private isPrivacyChain;
}
//# sourceMappingURL=router.d.ts.map