import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const FUZZY_STOP_WORDS = new Set([
  "and",
  "creative",
  "earring",
  "earrings",
  "edition",
  "jewelry",
  "of",
  "resistance",
  "the",
  "variant",
  "with",
]);

export const ORDER_LINE_MATCHING_DEFAULTS = {
  autoAcceptScore: 0.9,
  autoAcceptMargin: 0.08,
};

export function normalizeOrderLineText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenForComparison(token) {
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

export function orderLineTokens(value) {
  return normalizeOrderLineText(value)
    .split(" ")
    .map(tokenForComparison)
    .filter((token) => token && !FUZZY_STOP_WORDS.has(token));
}

function levenshteinDistance(left, right) {
  const rows = left.length;
  const columns = right.length;
  const distances = Array.from({ length: rows + 1 }, () => Array(columns + 1).fill(0));

  for (let row = 0; row <= rows; row += 1) distances[row][0] = row;
  for (let column = 0; column <= columns; column += 1) distances[0][column] = column;

  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      distances[row][column] = Math.min(
        distances[row - 1][column] + 1,
        distances[row][column - 1] + 1,
        distances[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
  }

  return distances[rows][columns];
}

export function orderLineSimilarity(left, right) {
  const leftTokens = orderLineTokens(left);
  const rightTokens = orderLineTokens(right);
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersectionSize = Array.from(leftSet).filter((token) => rightSet.has(token)).length;
  const unionSize = new Set([...leftSet, ...rightSet]).size || 1;
  const jaccard = intersectionSize / unionSize;
  const containment = intersectionSize / Math.max(1, Math.min(leftSet.size, rightSet.size));
  const leftComparable = leftTokens.join(" ");
  const rightComparable = rightTokens.join(" ");
  const edit =
    1 - levenshteinDistance(leftComparable, rightComparable) / Math.max(1, leftComparable.length, rightComparable.length);

  return Math.max(jaccard * 0.65 + edit * 0.35, containment * 0.92);
}

export function buildVariantLineCandidates(indexes) {
  const candidates = [];
  const seen = new Set();
  const variantCountByProduct = new Map();

  for (const variant of indexes.variantsByShopifyId.values()) {
    variantCountByProduct.set(variant.productShopifyId, (variantCountByProduct.get(variant.productShopifyId) ?? 0) + 1);
  }

  for (const variant of indexes.variantsByShopifyId.values()) {
    const product = indexes.productsByShopifyId.get(variant.productShopifyId);
    if (!product) continue;

    const displayNames = [];
    const hasVariantTitle = variant.title && !["default title", "none"].includes(variant.title.toLowerCase());
    if (!hasVariantTitle || variantCountByProduct.get(variant.productShopifyId) === 1) {
      displayNames.push(product.title);
    }
    if (hasVariantTitle) {
      displayNames.push(`${product.title} - ${variant.title}`);
    }

    for (const displayName of displayNames) {
      const key = `${variant.shopifyId}:${normalizeOrderLineText(displayName)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        displayName,
        normalizedDisplayName: normalizeOrderLineText(displayName),
        variant,
      });
    }
  }

  return candidates;
}

export function findBestFuzzyOrderLineMatch(lineName, candidates, defaults = ORDER_LINE_MATCHING_DEFAULTS) {
  const lineTokenSet = new Set(orderLineTokens(lineName));
  const ranked = candidates
    .map((candidate) => {
      let confidence = orderLineSimilarity(lineName, candidate.displayName);
      const candidateTokenSet = new Set(orderLineTokens(candidate.displayName));
      const variantTokens = ["default title", "none"].includes(String(candidate.variant.title ?? "").toLowerCase())
        ? []
        : orderLineTokens(candidate.variant.title);
      if (variantTokens.length > 0) {
        const matchedVariantTokens = variantTokens.filter((token) => lineTokenSet.has(token)).length;
        if (matchedVariantTokens === variantTokens.length) confidence += 0.04;
        else if (matchedVariantTokens === 0) confidence -= 0.08;
      }
      return {
        ...candidate,
        extraTokenCount: Array.from(candidateTokenSet).filter((token) => !lineTokenSet.has(token)).length,
        confidence: Math.max(0, Math.min(1, confidence)),
      };
    })
    .sort((left, right) => right.confidence - left.confidence || left.extraTokenCount - right.extraTokenCount);
  const best = ranked[0] ?? null;
  const secondBest = ranked.find((candidate) => candidate.variant.shopifyId !== best?.variant.shopifyId) ?? null;
  const margin = best ? best.confidence - (secondBest?.confidence ?? 0) : 0;
  const clearTokenSpecificityWin = Boolean(
    best && secondBest && best.extraTokenCount + 1 <= secondBest.extraTokenCount && best.confidence >= defaults.autoAcceptScore,
  );

  return {
    best,
    secondBest,
    margin,
    autoAccepted: Boolean(
      best && best.confidence >= defaults.autoAcceptScore && (margin >= defaults.autoAcceptMargin || clearTokenSpecificityWin),
    ),
  };
}

export function loadOrderLineMap(file) {
  if (!file || !existsSync(file)) return { version: 1, mappings: {} };
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed && typeof parsed === "object" && parsed.mappings && typeof parsed.mappings === "object") {
    return { version: parsed.version ?? 1, mappings: parsed.mappings };
  }
  return { version: 1, mappings: parsed && typeof parsed === "object" ? parsed : {} };
}

export function saveOrderLineMap(file, map) {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(map, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

function mappingVariantId(mapping) {
  if (typeof mapping === "string") return mapping;
  return mapping?.variantShopifyId ?? null;
}

function lineSummaryStats() {
  return {
    count: 0,
    quantity: 0,
    suggestions: [],
  };
}

function addLineSummary(map, lineName, quantity = 1, suggestion = null) {
  const summary = map.get(lineName) ?? lineSummaryStats();
  summary.count += 1;
  summary.quantity += quantity;
  if (suggestion && summary.suggestions.length < 3) summary.suggestions.push(suggestion);
  map.set(lineName, summary);
}

function createMappingEntry({ variant, displayName, confidence, source, now }) {
  return {
    variantShopifyId: variant.shopifyId,
    displayName,
    confidence: Number(confidence.toFixed(4)),
    source,
    updatedAt: now().toISOString(),
    createdAt: now().toISOString(),
  };
}

async function confirmInteractiveMatch(lineName, fuzzyMatch, readline) {
  const best = fuzzyMatch.best;
  if (!best) return null;
  const answer = await readline.question(
    `Map "${lineName}" to "${best.displayName}" (${Math.round(best.confidence * 100)}% confidence)? [y/N] `,
  );
  return ["y", "yes"].includes(answer.trim().toLowerCase()) ? best : null;
}

export function createOrderLineResolver({
  indexes,
  orderLineMap = { version: 1, mappings: {} },
  fuzzyEnabled = true,
  interactive = false,
  now = () => new Date(),
  defaults = ORDER_LINE_MATCHING_DEFAULTS,
} = {}) {
  const candidates = buildVariantLineCandidates(indexes);
  const pendingMappings = new Map();
  const stats = {
    exact: 0,
    mapped: 0,
    fuzzy: 0,
    interactive: 0,
    staleMappings: new Map(),
    ambiguous: new Map(),
    unresolved: new Map(),
  };
  let readline = null;

  const resolver = {
    stats,
    pendingMappings,
    async close() {
      readline?.close();
      readline = null;
    },
    async resolve(lineName, { quantity = 1 } = {}) {
      const exact = indexes.variantsByLineName.get(normalizeOrderLineText(lineName));
      if (exact) {
        stats.exact += 1;
        return exact;
      }

      const mappedVariantId = mappingVariantId(orderLineMap.mappings[lineName]);
      if (mappedVariantId) {
        const mappedVariant = indexes.variantsByShopifyId.get(mappedVariantId);
        if (mappedVariant) {
          stats.mapped += 1;
          return mappedVariant;
        }
        addLineSummary(stats.staleMappings, lineName, quantity, mappedVariantId);
      }

      if (fuzzyEnabled) {
        const fuzzyMatch = findBestFuzzyOrderLineMatch(lineName, candidates, defaults);
        if (fuzzyMatch.autoAccepted) {
          stats.fuzzy += 1;
          pendingMappings.set(
            lineName,
            createMappingEntry({
              variant: fuzzyMatch.best.variant,
              displayName: fuzzyMatch.best.displayName,
              confidence: fuzzyMatch.best.confidence,
              source: "fuzzy",
              now,
            }),
          );
          return fuzzyMatch.best.variant;
        }

        if (interactive && process.stdin.isTTY) {
          readline ??= createInterface({ input, output });
          const confirmed = await confirmInteractiveMatch(lineName, fuzzyMatch, readline);
          if (confirmed) {
            stats.interactive += 1;
            pendingMappings.set(
              lineName,
              createMappingEntry({
                variant: confirmed.variant,
                displayName: confirmed.displayName,
                confidence: confirmed.confidence,
                source: "interactive",
                now,
              }),
            );
            return confirmed.variant;
          }
        }

        addLineSummary(stats.ambiguous, lineName, quantity, {
          displayName: fuzzyMatch.best?.displayName,
          confidence: fuzzyMatch.best?.confidence ?? 0,
          secondDisplayName: fuzzyMatch.secondBest?.displayName,
          secondConfidence: fuzzyMatch.secondBest?.confidence ?? 0,
        });
      }

      addLineSummary(stats.unresolved, lineName, quantity);
      return null;
    },
  };

  return resolver;
}

export function mergePendingOrderLineMappings(orderLineMap, pendingMappings) {
  const next = {
    version: orderLineMap.version ?? 1,
    mappings: { ...(orderLineMap.mappings ?? {}) },
  };

  for (const [lineName, entry] of pendingMappings) {
    const existing = next.mappings[lineName];
    next.mappings[lineName] = {
      ...(typeof existing === "object" && existing ? existing : {}),
      ...entry,
      createdAt: typeof existing === "object" && existing?.createdAt ? existing.createdAt : entry.createdAt,
    };
  }

  return next;
}

export function summarizeOrderLineMatching(stats) {
  const lines = [
    `- exact catalog matches: ${stats.exact}`,
    `- mapping file matches: ${stats.mapped}`,
    `- auto fuzzy matches: ${stats.fuzzy}`,
    `- prompted matches: ${stats.interactive}`,
  ];

  const appendSummaries = (label, summaries) => {
    if (summaries.size === 0) return;
    lines.push(`- ${label}: ${summaries.size}`);
    for (const [lineName, summary] of summaries) {
      const suggestion = summary.suggestions[0];
      const suggestionText = suggestion?.displayName
        ? `; best suggestion "${suggestion.displayName}" (${Math.round(suggestion.confidence * 100)}%)`
        : "";
      lines.push(`  - ${lineName}: ${summary.count} row(s), qty ${summary.quantity}${suggestionText}`);
    }
  };

  appendSummaries("stale mapping entries", stats.staleMappings);
  appendSummaries("ambiguous unresolved fuzzy matches", stats.ambiguous);
  appendSummaries("unresolved order lines", stats.unresolved);

  return lines;
}
