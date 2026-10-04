const OPTIONAL_FEATURES = [
  "db",
  "ui",
  "history",
  "workflow",
] as const;

export type OptionalFeature =
  (typeof OPTIONAL_FEATURES)[number];

function parseFeatures(
  value: string | undefined,
): Set<OptionalFeature> {
  if (!value?.trim()) {
    return new Set();
  }

  const requested = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const known = new Set<string>(OPTIONAL_FEATURES);

  const unknown = requested.filter(
    (feature) => !known.has(feature),
  );

  if (unknown.length > 0) {
    throw new Error(
      `Unknown REPO_CONTEXT_FEATURES: ${unknown.join(", ")}`,
    );
  }

  return new Set(requested as OptionalFeature[]);
}

const enabledFeatures = parseFeatures(
  process.env.REPO_CONTEXT_FEATURES,
);

export const featureConfig = {
  db: enabledFeatures.has("db"),
  ui: enabledFeatures.has("ui"),
  history: enabledFeatures.has("history"),
  workflow: enabledFeatures.has("workflow"),
};

export const issueIndexConfig = {
  path: process.env.ISSUE_INDEX_PATH?.trim() || null,
};
