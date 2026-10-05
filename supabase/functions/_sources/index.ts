// Registry of online price sources, keyed by chains.online_source.
import { kroger } from './kroger.ts';
import type { PriceSource } from './types.ts';
import { walmart } from './walmart.ts';

export const SOURCES: Record<string, PriceSource> = {
  [kroger.id]: kroger,
  [walmart.id]: walmart,
};

export type { Env, OnlinePrice, PriceSource } from './types.ts';
