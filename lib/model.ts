// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol the snapshot records as pre-token that passes
// the house's own watchlist rule, applied to every row: no token on record (no
// market cap, no CoinGecko id, no symbol), not a centralised exchange, not a
// wrapped, staked or bridged product (by category, by name, or by exchange
// prefix), and not a versioned pool of another protocol. The parent-protocol
// part of the house rule is not one of the snapshot's ten fields, so it cannot
// be applied here; the rest is applied exactly. The snapshot's watchlist is
// the floor — all 40 of its slugs are ranked — and the other rankable
// pre-token protocols, most of them below the floor, are the early rows the
// radar exists to find. Protocols whose token already trades are kept apart:
// the dashboard shows them with the market's own capitalisation, never mixed
// into the ranked board.
//
// Implied value is computed from the snapshot's own figures only, by one
// function applied to every protocol alike. No protocol name is special-cased.
//
//   multiple   the market's own multiple, measured from this snapshot: the
//              median market-cap-to-TVL ratio of the trading tokens. A
//              category with at least 4 trading tokens uses its own median;
//              any other protocol uses the global median. Both are clamped
//              to [0.05, 2.0]. Centralised exchanges are left out of the
//              measurement: exchange tokens are not DeFi multiples.
//   growth     1 + clamp(change_7d, -50, 100) / 100 * 0.5   (no report: 0)
//   maturity   0.6 + 0.4 * min(age_days, 730) / 730          (no date: 365)
//   breadth    1 + 0.03 * min(chains - 1, 5)                (distribution)
//   implied    max(1, round(tvl_usd * multiple * growth * maturity * breadth))
//
// The dashboard states this model, shows the measured multiples, and lets the
// reader re-run it with different constants in the model sandbox, so the
// ranking is a live function of the figures, never a hard-coded list.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_cap_chains: number;
  multiple_floor: number;
  multiple_cap: number;
  category_min_samples: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 730,
  unknown_age_days: 365,
  breadth_step: 0.03,
  breadth_cap_chains: 5,
  multiple_floor: 0.05,
  multiple_cap: 2.0,
  category_min_samples: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 32;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The market multiples measured from the snapshot's trading tokens. */
export interface MarketMultiples {
  /** The global median market-cap-to-TVL ratio. */
  global: number;
  /** How many trading tokens the global median was measured from. */
  global_samples: number;
  /** Per-category medians, for categories with enough trading tokens. */
  by_category: Record<string, number>;
  /** Sample counts behind each per-category median. */
  category_samples: Record<string, number>;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_kind: 'category' | 'global';
    multiple_samples: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the figures, the model's breakdown, and the farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  multiple_kind: 'category' | 'global';
  multiple_samples: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  multiples: MarketMultiples;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  scanned: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers; the list is sorted in place. */
function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The house rule's wrapped / staked / bridged product categories. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** The house rule's whole-word test: a wrapped, staked or staking product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The house rule's exchange-name test: a product that begins with an exchange's name. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)([^a-z]|$)/i;

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product of a token that already trades, by the house's own
 * watchlist rule. WBTC, Binance staked ETH and USDT0 fail it, as they should:
 * none of them is a protocol still waiting on a launch of its own.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/**
 * The market's multiples, measured from the snapshot's own trading tokens: the
 * median market-cap-to-TVL ratio, globally and per category. Categories are
 * visited in sorted order so the result is byte-stable between runs.
 */
export function marketMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): MarketMultiples {
  const ratios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    ratios.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
    }
  }
  const global = ratios.length > 0 ? clamp(median(ratios), model.multiple_floor, model.multiple_cap) : 0.2;
  const by_category: Record<string, number> = {};
  const category_samples: Record<string, number> = {};
  for (const category of [...byCategory.keys()].sort()) {
    const list = byCategory.get(category)!;
    if (list.length >= model.category_min_samples) {
      by_category[category] = round4(clamp(median(list), model.multiple_floor, model.multiple_cap));
      category_samples[category] = list.length;
    }
  }
  return { global: round4(global), global_samples: ratios.length, by_category, category_samples };
}

/** The multiple one protocol gets: its category's median when measured, else the global median. */
export function multipleFor(
  p: SnapshotProtocol,
  multiples: MarketMultiples,
): { multiple: number; kind: 'category' | 'global'; samples: number } {
  if (p.category !== null && multiples.by_category[p.category] !== undefined) {
    return { multiple: multiples.by_category[p.category]!, kind: 'category', samples: multiples.category_samples[p.category]! };
  }
  return { multiple: multiples.global, kind: 'global', samples: multiples.global_samples };
}

/** The implied value and every factor behind it, for one protocol. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: MarketMultiples,
  model: ModelConstants = MODEL,
): {
  implied: number;
  multiple: number;
  multipleKind: 'category' | 'global';
  multipleSamples: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, kind, samples } = multipleFor(protocol, multiples);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.max(0, protocol.chains.length - 1);
  const breadthMult = 1 + model.breadth_step * Math.min(extraChains, model.breadth_cap_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, multipleKind: kind, multipleSamples: samples, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = marketMultiples(snapshot, model);
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlist = new Set(snapshot.watchlist);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      multiple: s.v.multiple,
      multiple_kind: s.v.multipleKind,
      multiple_samples: s.v.multipleSamples,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A typical per-transaction gas cost on a chain, in words. Chains are matched by name, loosely. */
function gasOn(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return '$3–$12 of gas per transaction';
  if (c.includes('solana') || c.includes('hyperliquid') || c.includes('monad') || c.includes('plasma') || c.includes('megaeth')) return 'under $0.10 of gas per transaction';
  if (c.includes('bitcoin')) return '$1–$5 of gas per transaction';
  if (c.includes('tron')) return 'under $2 of gas per transaction';
  if (c.includes('binance') || c.includes('bsc')) return 'under $0.50 of gas per transaction';
  if (c.includes('berachain') || c.includes('bittensor') || c.includes('stellar') || c.includes('sui') || c.includes('aptos') || c.includes('near')) return 'under $1 of gas per transaction';
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('polygon') || c.includes('unichain') || c.includes('ink') || c.includes('blast') || c.includes('mode') || c.includes('linea') || c.includes('scroll') || c.includes('zksync') || c.includes('starknet') || c.includes('avalanche') || c.includes('fantom') || c.includes('gnosis') || c.includes('celo') || c.includes('mantle') || c.includes('taiko') || c.includes('zora') || c.includes('world')) return 'under $1 of gas per transaction';
  return 'under $5 of gas per transaction';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 100;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateralized')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave the supply position open`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP position`;
  if (c.includes('yield aggregator') || c.includes('leveraged farm')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and hold the vault shares`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s main yield vault on ${chain} and hold the receipt`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC through ${name} to ${chain}, then use the bridged funds inside its app`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking pool') || c.includes('staking')) return `Stake $${capital} through ${name} on ${chain} and hold the staking receipt token`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position`;
  if (c.includes('risk curator') || c.includes('curator')) return `Deposit $${capital} into a ${name}-curated vault on ${chain} and hold the shares`;
  if (c.includes('capital allocator') || c.includes('allocator')) return `Allocate $${capital} through ${name}'s vaults on ${chain} and hold the allocation receipt`;
  if (c.includes('basis trad')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold the position`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it`;
  if (c.includes('rwa')) return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in an active market on ${name}`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`;
  if (c.includes('nft')) return `List or buy one item through ${name} on ${chain} with $${capital} of funds`;
  if (c.includes('chain')) return `Use ${name}'s own app with $${capital} on ${chain} and keep the position open`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s main farm on ${chain} and hold the position`;
  if (c.includes('reserve currency') || c.includes('treasury')) return `Bond or stake $${capital} through ${name} on ${chain} and hold the receipt`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * Every step is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names. Costs are typical
 * figures for the chain, stated as such; nothing here claims the protocol
 * runs a points program or an airdrop.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasOn(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const others = p.chains.length > 1 ? ` It also runs on ${p.chains.slice(1, 3).join(', ')}${p.chains.length > 3 ? ` and ${p.chains.length - 3} more` : ''}; repeating the position there is optional.` : '';
  return [
    {
      text: `Set up a fresh wallet holding only the funds you plan to farm, keep its seed phrase offline, and fund it with $${capital} plus gas on ${chain}. Open the protocol's app only from the link its own official channels publish.${others}`,
      cost: gas,
      time: '10 minutes',
    },
    {
      text: `${action}. Confirm the transaction, then check the position shows in the app before you do anything else.`,
      cost: `$${capital} of capital plus ${gas}`,
      time: '15 minutes',
    },
    {
      text: `Touch the position once a week: a small extra deposit, a swap, a vote, or a claim inside the app, so the wallet stays active across snapshots.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity is counted in more than one snapshot window instead of a single day.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own rewards or points page from its official channels and claim only there. Never pay a fee to claim, never connect a wallet from a direct message, and ignore anyone offering to help you claim.`,
      cost: 'nothing to check; never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Keep a farm log: the wallet, the dates, and every transaction hash. When you unwind, withdraw in two or three steps over a few days rather than all at once, and keep the log for the next position.`,
      cost: gas,
      time: '10 minutes',
    },
  ];
}

// ---------------------------------------------------------------- assembly

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js: the figures, the model's breakdown, and the farm plan. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_kind: row.model.multiple_kind,
    multiple_samples: row.model.multiple_samples,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = marketMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    multiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    scanned: snapshot.protocols.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate needs`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
