import { SwapRequest, Quote } from '../types';
import { AdapterRegistry } from '../adapters';
export interface QuoteSource {
    name: string;
    getQuote(request: SwapRequest): Promise<Quote | null>;
}
export declare class QuoteEngine {
    private sources;
    private adapters;
    constructor(adapters: AdapterRegistry);
    registerSource(source: QuoteSource): void;
    getQuotes(request: SwapRequest): Promise<Quote[]>;
}
//# sourceMappingURL=quote-engine.d.ts.map