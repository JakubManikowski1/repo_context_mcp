import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  getLegacyRepositoryContext,
  type RepositoryContext,
} from "./repository-context.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

const MAX_FILE_BYTES = 250_000;

const HARD_MAX_QUERIES = 8;
const HARD_MAX_SEARCH_TERMS = 12;
const HARD_MAX_CODE_SEARCH_TERMS = 3;
const HARD_MAX_PATHS = 20;
const HARD_MAX_FILES = 24;
const HARD_MAX_LINES_PER_FILE = 400;
const HARD_MAX_CHARS = 60_000;

const DEFAULT_MAX_FILES = 16;
const DEFAULT_MAX_LINES_PER_FILE = 120;
const SEARCH_MAX_LINES_PER_FILE = 60;
const DEFAULT_MAX_CHARS = 30_000;

const MAX_REPORTED_CANDIDATES = 30;


function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(Math.max(value, min), max);
}

function findTreeMatches(
  paths: string[],
  term: string,
  includeDocumentation: boolean,
) {
  const normalized =
    term.trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  const needles = [normalized];

  const moduleSymbol =
    normalized.match(
      /^([a-z_$][a-z0-9_$-]{4,})\.([a-z_$][a-z0-9_$-]{2,})$/i,
    );

  if (moduleSymbol) {
    needles.unshift(
      moduleSymbol[1].toLowerCase(),
    );
  }

  const matches = paths
    .filter(
      (filePath) =>
        includeDocumentation ||
        !isDocumentationPath(filePath),
    )
    .map((filePath) => {
      const lowerPath =
        filePath.toLowerCase();

      const basename =
        lowerPath
          .split("/")
          .at(-1) ??
        lowerPath;

      const stem =
        basename.replace(
          /\.[^.]+$/,
          "",
        );

      let score = 0;

      for (const needle of needles) {
        if (needle === basename) {
          score = Math.max(score, 1000);
        } else if (needle === stem) {
          score = Math.max(score, 950);
        } else if (
          needle.length >= 6 &&
          basename.includes(needle)
        ) {
          score = Math.max(score, 800);
        } else if (
          needle.length >= 8 &&
          lowerPath.includes(needle)
        ) {
          score = Math.max(score, 600);
        }
      }

      return {
        path: filePath,
        name:
          filePath.split("/").at(-1) ??
          filePath,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return matches;
}

function isDocumentationPath(path: string): boolean {
  const lower = path.toLowerCase();

  return (
    lower === "backlog.md" ||
    lower === "claude.md" ||
    lower === "agents.md" ||
    lower.endsWith(".md") ||
    lower.endsWith(".mdx") ||
    lower.startsWith(".claude/") ||
    lower.startsWith(".github/prompts/") ||
    lower.startsWith(".github/instructions/")
  );
}

async function readFile(
  repository: RepositoryContext,
  path: string,
  ref: string,
) {
  const octokit = repository.octokit;

  try {
    const response = await octokit.rest.repos.getContent({
      owner: repository.owner,
      repo: repository.repo,
      path,
      ref,
    });

    if (
      Array.isArray(response.data) ||
      response.data.type !== "file" ||
      !("content" in response.data)
    ) {
      return {
        path,
        error: "Not a readable file",
      };
    }

    if (response.data.size > MAX_FILE_BYTES) {
      return {
        path,
        error: `File too large: ${response.data.size} bytes`,
      };
    }

    return {
      path,
      sha: response.data.sha,
      content: Buffer.from(
        response.data.content.replace(/\n/g, ""),
        "base64",
      ).toString("utf8"),
    };
  } catch (error) {
    return {
      path,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

export function extractSearchSnippets(
  content: string,
  queries: string[],
  maxLines: number,
  radius = 8,
  maxWindows = 3,
  includeAdditionalHits = true,
) {
  const lines = content.split(/\r?\n/);

  // Mały plik warto pokazać w całości.
  if (lines.length <= Math.min(maxLines, 120)) {
    return {
      content,
      totalLines: lines.length,
      returnedLines: lines.length,
      truncated: false,
    };
  }

  // Kolejność queries jest istotna:
  // model zwykle podaje konkretne symbole przed
  // szerszymi terminami typu "sale" czy "proposed".
  const needles = [
    ...new Set(
      queries
        .map((query) =>
          query.trim().toLowerCase(),
        )
        .filter(
          (query) => query.length >= 2,
        ),
    ),
  ];

  const scoreHit = (
    lineIndex: number,
    needle: string,
  ) => {
    // Definition-first tylko dla symboli wyglądających
    // jak identyfikatory. Frazy typu "tax_regime",
    // "propose-invoice" itd. zachowują kolejność pliku.
    if (
      !/^[a-z_$][a-z0-9_$]*$/i.test(
        needle,
      )
    ) {
      return 0;
    }

    const escapedNeedle =
      needle.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );

    const line =
      lines[lineIndex].toLowerCase();

    const previous =
      lineIndex > 0
        ? lines[lineIndex - 1].toLowerCase()
        : "";

    const next =
      lineIndex + 1 < lines.length
        ? lines[lineIndex + 1].toLowerCase()
        : "";

    const context =
      `${previous}\n${line}\n${next}`;

    if (
      new RegExp(
        `\\b(?:export\\s+)?(?:async\\s+)?function\\s+${escapedNeedle}\\b`,
      ).test(context)
    ) {
      return 100;
    }

    if (
      new RegExp(
        `\\b(?:const|let|var)\\s+${escapedNeedle}\\s*=`,
      ).test(context)
    ) {
      return 95;
    }

    if (
      new RegExp(
        `^\\s*(?:async\\s+)?${escapedNeedle}\\s*\\(`,
      ).test(line)
    ) {
      return 90;
    }

    if (
      new RegExp(
        `\\b${escapedNeedle}\\s*:\\s*(?:async\\s*)?`,
      ).test(context)
    ) {
      return 85;
    }

    return 0;
  };

  const findDefinitionWindow = (
    hit: number,
    needle: string,
  ): [number, number] | null => {
    if (scoreHit(hit, needle) <= 0) {
      return null;
    }

    let parenDepth = 0;
    let bracketDepth = 0;
    let bodyDepth = 0;
    let bodyStarted = false;

    let inBlockComment = false;
    let quote: "'" | '"' | "`" | null =
      null;
    let escaped = false;

    const escapedNeedle =
      needle.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );

    const signaturePreview =
      lines
        .slice(
          hit,
          Math.min(
            lines.length,
            hit + 6,
          ),
        )
        .join("\n");

    // Hooki/rejestratory w stylu:
    // onRecordAfterCreateSuccess((e) => {
    //   ...
    // }, "invoices");
    //
    // Dla nich ciało callbacka znajduje się wewnątrz
    // nawiasów wywołania, więc zwykłe wykrywanie
    // function/method body go nie obejmuje.
    const arrowCallbackRegistration =
      new RegExp(
        `^\\s*${escapedNeedle}\\s*\\(\\s*(?:async\\s*)?(?:\\([^)]*\\)|[a-z_$][a-z0-9_$]*)\\s*=>\\s*\\{`,
        "i",
      ).test(signaturePreview);

    let callbackArrowSeen = false;

    // Sygnatura może być wieloliniowa.
    // Nie szukamy jednak początku ciała bez końca,
    // jeżeli trafienie nie było faktycznie definicją.
    const signatureSearchEnd = Math.min(
      lines.length - 1,
      hit + 40,
    );

    for (
      let lineIndex = hit;
      lineIndex < lines.length;
      lineIndex++
    ) {
      if (
        !bodyStarted &&
        lineIndex > signatureSearchEnd
      ) {
        return null;
      }

      const line = lines[lineIndex];

      const firstChar =
        lineIndex === hit
          ? Math.max(
              0,
              line
                .toLowerCase()
                .indexOf(needle),
            )
          : 0;

      for (
        let charIndex = firstChar;
        charIndex < line.length;
        charIndex++
      ) {
        const char = line[charIndex];
        const next =
          line[charIndex + 1] ?? "";

        if (inBlockComment) {
          if (
            char === "*" &&
            next === "/"
          ) {
            inBlockComment = false;
            charIndex++;
          }

          continue;
        }

        if (quote) {
          if (escaped) {
            escaped = false;
            continue;
          }

          if (char === "\\") {
            escaped = true;
            continue;
          }

          if (char === quote) {
            quote = null;
          }

          continue;
        }

        if (
          char === "/" &&
          next === "/"
        ) {
          break;
        }

        if (
          char === "/" &&
          next === "*"
        ) {
          inBlockComment = true;
          charIndex++;
          continue;
        }

        if (
          char === "'" ||
          char === '"' ||
          char === "`"
        ) {
          quote = char;
          escaped = false;
          continue;
        }

        if (!bodyStarted) {
          if (
            arrowCallbackRegistration &&
            char === "=" &&
            next === ">"
          ) {
            callbackArrowSeen = true;
            charIndex++;
            continue;
          }

          if (char === "(") {
            parenDepth++;
            continue;
          }

          if (char === ")") {
            parenDepth = Math.max(
              0,
              parenDepth - 1,
            );
            continue;
          }

          if (char === "[") {
            bracketDepth++;
            continue;
          }

          if (char === "]") {
            bracketDepth = Math.max(
              0,
              bracketDepth - 1,
            );
            continue;
          }

          // Pomijamy klamry destrukturyzacji
          // parametrów. Klamra ciała pojawia się
          // dopiero poza () i [].
          const regularBodyStart =
            parenDepth === 0 &&
            bracketDepth === 0;

          const callbackBodyStart =
            arrowCallbackRegistration &&
            callbackArrowSeen &&
            parenDepth > 0;

          if (
            char === "{" &&
            (
              regularBodyStart ||
              callbackBodyStart
            )
          ) {
            bodyStarted = true;
            bodyDepth = 1;
          }

          continue;
        }

        if (char === "{") {
          bodyDepth++;
          continue;
        }

        if (char === "}") {
          bodyDepth--;

          if (bodyDepth === 0) {
            return [
              Math.max(0, hit - 2),
              Math.min(
                lines.length - 1,
                lineIndex + 2,
              ),
            ];
          }
        }
      }
    }

    return null;
  };

  const hitsByNeedle = needles.map(
    (needle) => {
      const hits: number[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (
          lines[i]
            .toLowerCase()
            .includes(needle)
        ) {
          hits.push(i);
        }
      }

      // Dla nazw funkcji/metod definicja ma pierwszeństwo
      // przed call-site. Przy takim samym wyniku zachowujemy
      // naturalną kolejność linii.
      hits.sort(
        (a, b) =>
          scoreHit(b, needle) -
            scoreHit(a, needle) ||
          a - b,
      );

      return {
        needle,
        hits,
      };
    },
  );

  const hasAnyHit = hitsByNeedle.some(
    ({ hits }) => hits.length > 0,
  );

  // GitHub wskazał plik, ale literalnego trafienia
  // nie znaleźliśmy lokalnie w treści.
  if (!hasAnyHit) {
    const count = Math.min(maxLines, 60);

    return {
      content:
        `[lines 1-${count}]\n` +
        lines.slice(0, count).join("\n"),
      totalLines: lines.length,
      returnedLines: count,
      truncated: count < lines.length,
    };
  }

  let windows: Array<[number, number]> = [];

  const tryAddHit = (
    hit: number,
    needle?: string,
    preferDefinition = false,
  ) => {
    const definitionWindow =
      preferDefinition && needle
        ? findDefinitionWindow(
            hit,
            needle,
          )
        : null;

    const candidate: [number, number] =
      definitionWindow ?? [
        Math.max(0, hit - radius),
        Math.min(
          lines.length - 1,
          hit + radius,
        ),
      ];

    // Normalizujemy razem z istniejącymi oknami,
    // dzięki czemu merge działa także wtedy,
    // gdy queries wskazują miejsca w innej
    // kolejności niż linie w pliku.
    const combined: Array<
      [number, number]
    > = [
      ...windows.map(
        ([start, end]) =>
          [start, end] as [number, number],
      ),
      candidate,
    ].sort(
      (a, b) => a[0] - b[0],
    );

    const merged: Array<
      [number, number]
    > = [];

    for (const [
      start,
      end,
    ] of combined) {
      const previous = merged.at(-1);

      if (
        previous &&
        start <= previous[1] + 3
      ) {
        previous[1] = Math.max(
          previous[1],
          end,
        );
      } else {
        merged.push([start, end]);
      }
    }

    // Istniejące okna mają wyższy priorytet.
    // Jeśli nowe trafienie wymagałoby kolejnego
    // okna ponad limit, po prostu go nie dodajemy.
    if (merged.length > maxWindows) {
      return false;
    }

    windows = merged;
    return true;
  };

  // PASS 1:
  // gwarantujemy szansę na jedno okno dla każdego
  // query zanim częsty termin dostanie kolejne.
  for (
    const {
      needle,
      hits,
    } of hitsByNeedle
  ) {
    if (hits.length === 0) continue;

    tryAddHit(
      hits[0],
      needle,
      !includeAdditionalHits,
    );
  }

  // PASS 2:
  // Search mode może wykorzystać dodatkowe trafienia.
  // Focused fetch celowo bierze tylko jedno najlepsze
  // trafienie na query, żeby ogólne terminy nie
  // rozciągały snippetów na setki linii.
  if (includeAdditionalHits) {
    for (const { hits } of hitsByNeedle) {
      for (const hit of hits.slice(1)) {
        tryAddHit(hit);
      }
    }
  }

  windows.sort(
    (a, b) => a[0] - b[0],
  );

  let remainingLines = maxLines;
  let returnedLines = 0;

  const chunks: string[] = [];

  for (const [
    start,
    originalEnd,
  ] of windows) {
    if (remainingLines <= 0) break;

    const end = Math.min(
      originalEnd,
      start + remainingLines - 1,
    );

    const count = end - start + 1;

    chunks.push(
      `[lines ${start + 1}-${end + 1}]\n` +
        lines
          .slice(start, end + 1)
          .join("\n"),
    );

    returnedLines += count;
    remainingLines -= count;
  }

  return {
    content: chunks.join("\n\n---\n\n"),
    totalLines: lines.length,
    returnedLines,
    truncated: returnedLines < lines.length,
  };
}

function extractFetchedContent(
  content: string,
  maxLines: number,
) {
  const lines = content.split(/\r?\n/);

  const selected = lines.slice(
    0,
    maxLines,
  );

  return {
    content: selected.join("\n"),
    totalLines: lines.length,
    returnedLines: selected.length,
    truncated:
      selected.length < lines.length,
  };
}

const inputSchema = z
  .object({
    queries: z
      .array(z.string().min(1))
      .min(1)
      .optional(),

    paths: z
      .array(z.string().min(1))
      .min(1)
      .optional(),

    focusQueries: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        "FETCH MODE ONLY. Optional symbols, function names, identifiers, routes, or other literal code terms to focus excerpts inside the requested paths. Use this when fetching multiple large files instead of requesting huge line/character limits.",
      ),

    path: z.string().min(1).optional(),

    extension: z
      .string()
      .min(1)
      .optional(),

    // Celowo bez max() w schema.
    // Zbyt ambitny parametr modelu nie może
    // zmarnować całego tool calla.
    maxFiles: z.number().int().optional(),

    maxLinesPerFile: z
      .number()
      .int()
      .optional(),

    maxChars: z.number().int().optional(),

    includeDocumentation:
      z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasQueries = Boolean(
      value.queries?.length,
    );

    const hasPaths = Boolean(
      value.paths?.length,
    );

    if (hasQueries === hasPaths) {
      ctx.addIssue({
        code: "custom",
        message:
          "Provide exactly one of: queries (search mode) or paths (fetch mode).",
      });
    }

    if (
      hasPaths &&
      (value.path || value.extension)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "path and extension filters are valid only in search mode.",
      });
    }

    if (
      value.focusQueries?.length &&
      !hasPaths
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "focusQueries are valid only in fetch mode together with paths.",
      });
    }
  });

const REPO_CODE_TURN_LIMIT = 3;
const REPO_CODE_TURN_BUDGET_TTL_MS =
  30 * 60 * 1000;

const repoCodeTurnBudgets = new Map<
  string,
  {
    used: number;
    touchedAt: number;
    head: string;
  }
>();

function consumeRepoCodeTurnBudget(
  repositoryKey: string,
  requestId: string | undefined,
  currentHead: string,
) {
  if (!requestId) {
    return {
      enforced: false,
      allowed: true,
      repositoryChanged: false,
      previousHead: null as string | null,
      head: currentHead,
      used: 0,
      remaining: REPO_CODE_TURN_LIMIT,
    };
  }

  const budgetKey = JSON.stringify([
    repositoryKey,
    requestId,
  ]);

  const now = Date.now();

  for (const [key, value] of repoCodeTurnBudgets) {
    if (
      now - value.touchedAt >
      REPO_CODE_TURN_BUDGET_TTL_MS
    ) {
      repoCodeTurnBudgets.delete(key);
    }
  }

  const current =
    repoCodeTurnBudgets.get(budgetKey);

  // main zmienił się w trakcie tej samej odpowiedzi.
  // Cały wcześniejszy kontekst repo jest nieważny.
  //
  // Ten call NIE zużywa budżetu nowej analizy.
  if (
    current &&
    current.head !== currentHead
  ) {
    repoCodeTurnBudgets.set(
      budgetKey,
      {
        used: 0,
        touchedAt: now,
        head: currentHead,
      },
    );

    return {
      enforced: true,
      allowed: false,
      repositoryChanged: true,
      previousHead: current.head,
      head: currentHead,
      used: 0,
      remaining: REPO_CODE_TURN_LIMIT,
    };
  }

  if (
    current &&
    current.used >= REPO_CODE_TURN_LIMIT
  ) {
    current.touchedAt = now;

    return {
      enforced: true,
      allowed: false,
      repositoryChanged: false,
      previousHead: null as string | null,
      head: currentHead,
      used: current.used,
      remaining: 0,
    };
  }

  const used =
    (current?.used ?? 0) + 1;

  repoCodeTurnBudgets.set(
    budgetKey,
    {
      used,
      touchedAt: now,
      head: currentHead,
    },
  );

  return {
    enforced: true,
    allowed: true,
    repositoryChanged: false,
    previousHead: null as string | null,
    head: currentHead,
    used,
    remaining:
      REPO_CODE_TURN_LIMIT - used,
  };
}

export function registerRepoCodeTools(
  server: McpServer,
  requestId?: string,
  repository: RepositoryContext = getLegacyRepositoryContext(),
) {

  server.registerTool(
    "repo_code",
    {
      description:
        "PRIMARY CODE ACCESS TOOL. Use queries when full repository-relative paths are unknown, including when you only know filenames, symbols, modules, routes, collections, or feature names. Search returns compact code from the best matches and reports additional candidate paths. Use paths ONLY for known full repository-relative paths such as src/services/example.ts; never send basenames or conceptual identifiers as paths. When fetching known large files, strongly prefer focusQueries with the relevant function names, symbols, routes, or identifiers. For function-like symbol queries, focused fetch attempts to return the complete definition through its closing brace instead of only a small surrounding excerpt. In SEARCH mode, use it primarily for discovery and normally request no more than 8 files; additional candidate paths are reported separately and can be fetched explicitly. If the task or issue references repository documentation, procedures, process IDs, runbooks, ADRs, README files, or slash commands such as ADR-12 or /deploy, set includeDocumentation=true and include those exact references in the search queries. Prefer one well-targeted call. Performance limits are applied internally and reported instead of rejecting oversized requests. A server-side analysis budget permits up to 3 productive repo_code calls per repository HEAD when the host provides a request id. If mode=repository_changed, discard repository conclusions from the previous HEAD and restart repository analysis against the new HEAD; that drift-detection call does not consume the new HEAD budget. If mode=budget_exhausted, do not retry repo_code for the same HEAD in the same response; continue using already retrieved context and state remaining uncertainty.",
      inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    },

    async ({
      queries,
      paths,
      focusQueries,
      path,
      extension,
      maxFiles = DEFAULT_MAX_FILES,
      maxLinesPerFile =
        DEFAULT_MAX_LINES_PER_FILE,
      maxChars = DEFAULT_MAX_CHARS,
      includeDocumentation = false,
    }) => {
      const octokit = repository.octokit;

      const currentHead =
        await getRepositoryHead(repository);

      const turnBudget =
        consumeRepoCodeTurnBudget(
          repository.key,
          requestId,
          currentHead,
        );

      if (turnBudget.repositoryChanged) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mode: "repository_changed",
                  message:
                    "Repository main HEAD changed during this response. Discard all repository conclusions derived from the previous HEAD and restart repository analysis from the beginning against the new HEAD. This detection did not consume the repo_code budget for the new HEAD.",
                  previousHead:
                    turnBudget.previousHead,
                  newHead:
                    turnBudget.head,
                  turnBudget: {
                    enforced:
                      turnBudget.enforced,
                    limit:
                      REPO_CODE_TURN_LIMIT,
                    used: 0,
                    remaining:
                      REPO_CODE_TURN_LIMIT,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (!turnBudget.allowed) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mode: "budget_exhausted",
                  message:
                    "repo_code budget for this response is exhausted. Do not call repo_code again in this response. Continue with the repository context already retrieved and state any remaining uncertainty explicitly.",
                  turnBudget: {
                    enforced:
                      turnBudget.enforced,
                    limit:
                      REPO_CODE_TURN_LIMIT,
                    used:
                      turnBudget.used,
                    remaining: 0,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const started = performance.now();

      const readFileAtHead = (
        filePath: string,
      ) =>
        readFile(
          repository,
          filePath,
          currentHead,
        );

      const effectiveMaxFiles = clamp(
        maxFiles,
        1,
        HARD_MAX_FILES,
      );

      const effectiveMaxLinesPerFile =
        clamp(
          maxLinesPerFile,
          30,
          HARD_MAX_LINES_PER_FILE,
        );

      // SEARCH ma być szeroki, ale płytki.
      // FETCH nadal może czytać dużo głębiej.
      const effectiveSearchMaxLinesPerFile =
        Math.min(
          effectiveMaxLinesPerFile,
          SEARCH_MAX_LINES_PER_FILE,
        );

      const effectiveMaxChars = clamp(
        maxChars,
        5_000,
        HARD_MAX_CHARS,
      );

      // ============================================
      // FETCH MODE
      // ============================================

      if (paths?.length) {
        const uniquePaths = [
          ...new Set(paths),
        ];

        const effectiveFocusQueries = [
          ...new Set(focusQueries ?? []),
        ].slice(
          0,
          HARD_MAX_SEARCH_TERMS,
        );

        const effectivePaths =
          uniquePaths.slice(
            0,
            HARD_MAX_PATHS,
          );

        const omittedPaths =
          uniquePaths.slice(
            HARD_MAX_PATHS,
          );

        const readStarted =
          performance.now();

        const results =
          await Promise.all(
            effectivePaths.map(
              (filePath) =>
                readFileAtHead(filePath),
            ),
          );

        const readMs = Math.round(
          performance.now() -
            readStarted,
        );

        let usedChars = 0;

        let readableRemaining =
          results.filter(
            (file) =>
              "content" in file &&
              typeof file.content ===
                "string",
          ).length;

        const files = [];

        for (const file of results) {
          if (
            !("content" in file) ||
            typeof file.content !==
              "string"
          ) {
            files.push(file);
            continue;
          }

          const extracted =
            effectiveFocusQueries.length > 0
              ? extractSearchSnippets(
                  file.content,
                  effectiveFocusQueries,
                  effectiveMaxLinesPerFile,
                  20,
                  6,
                  false,
                )
              : extractFetchedContent(
                  file.content,
                  effectiveMaxLinesPerFile,
                );

          const remaining =
            effectiveMaxChars -
            usedChars;

          if (remaining <= 0) {
            files.push({
              path: file.path,
              sha: file.sha,
              totalLines:
                extracted.totalLines,
              contentOmitted: true,
              reason:
                "Payload budget exhausted",
            });

            readableRemaining--;
            continue;
          }

          // Dzielimy pozostały budżet między
          // wszystkie pozostałe pliki.
          const fairShare = Math.min(
            remaining,
            Math.max(
              1_200,
              Math.floor(
                remaining /
                  Math.max(
                    readableRemaining,
                    1,
                  ),
              ),
            ),
          );

          const content =
            extracted.content.length >
            fairShare
              ? extracted.content.slice(
                  0,
                  fairShare,
                ) +
                "\n[TRUNCATED BY FAIR PAYLOAD BUDGET]"
              : extracted.content;

          usedChars += content.length;
          readableRemaining--;

          files.push({
            path: file.path,
            sha: file.sha,
            totalLines:
              extracted.totalLines,
            returnedLines:
              extracted.returnedLines,
            truncated:
              extracted.truncated ||
              content.length <
                extracted.content.length,
            content,
          });
        }

                return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mode: "fetch",

                  turnBudget: {
                    enforced:
                      turnBudget.enforced,
                    limit:
                      REPO_CODE_TURN_LIMIT,
                    used:
                      turnBudget.used,
                    remaining:
                      turnBudget.remaining,
                  },

                  repository:
                    `${repository.owner}/${repository.repo}`,

                  branch:
                    repository.branch,

                  head: currentHead,

                  focusQueries:
                    effectiveFocusQueries,

                  requestedPathCount:
                    uniquePaths.length,

                  effectivePathCount:
                    effectivePaths.length,

                  omittedPaths,

                  files,

                  timing: {
                    readMs,
                    totalMs: Math.round(
                      performance.now() -
                        started,
                    ),
                  },

                  limits: {
                    requested: {
                      maxLinesPerFile,
                      maxChars,
                    },

                    effective: {
                      maxLinesPerFile:
                        effectiveMaxLinesPerFile,
                      maxChars:
                        effectiveMaxChars,
                      maxPaths:
                        HARD_MAX_PATHS,
                    },
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ============================================
      // SEARCH MODE
      // ============================================

      const allQueries = [
        ...new Set(queries ?? []),
      ];

      const effectiveQueries =
        allQueries.slice(
          0,
          HARD_MAX_QUERIES,
        );

      const omittedQueries =
        allQueries.slice(
          HARD_MAX_QUERIES,
        );

      // Query typu:
      //   userService.createUser
      // może być zbyt restrykcyjne dla GitHub Code Search.
      //
      // Bez dodatkowego round-tripu rozszerzamy je więc do:
      //   - oryginalnego query
      //   - nazwy modułu
      //   - nazwy symbolu
      //
      // Ranking później nadal promuje jawne nazwy plików/modułów.
      const searchTerms = [
        ...new Set(
          effectiveQueries.flatMap(
            (query) => {
              const trimmed =
                query.trim();

              const terms = [
                trimmed,
              ];

              const moduleSymbol =
                trimmed.match(
                  /^([A-Za-z_$][A-Za-z0-9_$-]{4,})\.([A-Za-z_$][A-Za-z0-9_$-]{2,})$/,
                );

              if (moduleSymbol) {
                terms.push(
                  moduleSymbol[1],
                  moduleSymbol[2],
                );
              }

              return terms;
            },
          ),
        ),
      ].slice(
        0,
        HARD_MAX_SEARCH_TERMS,
      );

      const searchStarted =
        performance.now();

      const head =
        currentHead;

      let treeCacheHit = false;
      let treeMs = 0;
      let treeError: string | null = null;
      let treePaths: string[] = [];

      try {
        const treeResult =
          await getRepoTreeIndex(head, repository);

        treeCacheHit =
          treeResult.cacheHit;

        treeMs =
          treeResult.treeMs;

        treePaths =
          treeResult.index.paths;
      } catch (error) {
        treeError =
          error instanceof Error
            ? error.message
            : String(error);
      }

      const treeSearches = [];
      const unresolvedSearchTerms: string[] = [];

      for (const query of searchTerms) {
        const matches =
          treePaths.length > 0
            ? findTreeMatches(
                treePaths,
                query,
                includeDocumentation,
              )
            : [];

        if (matches.length > 0) {
          treeSearches.push({
            query,
            items: matches.map(
              ({ path, name }) => ({
                path,
                name,
              }),
            ),
          });
        } else {
          unresolvedSearchTerms.push(
            query,
          );
        }
      }

      const remoteSearchTerms =
        unresolvedSearchTerms.slice(
          0,
          HARD_MAX_CODE_SEARCH_TERMS,
        );

      const omittedRemoteSearchTerms =
        unresolvedSearchTerms.slice(
          HARD_MAX_CODE_SEARCH_TERMS,
        );

      const codeSearchStarted =
        performance.now();

      const remoteSearches =
        await Promise.all(
          remoteSearchTerms.map(
            async (query) => {
              const qualifiers = [
                `repo:${repository.owner}/${repository.repo}`,

                path
                  ? `path:${path}`
                  : null,

                extension
                  ? `extension:${extension}`
                  : null,
              ]
                .filter(Boolean)
                .join(" ");

              try {
                const response =
                  await octokit.rest.search.code(
                    {
                      q: `${query} ${qualifiers}`,
                      per_page: 50,
                    },
                  );

                return {
                  query,

                  items:
                    response.data.items
                      .filter(
                        (item) =>
                          includeDocumentation ||
                          !isDocumentationPath(
                            item.path,
                          ),
                      )
                      .map((item) => ({
                        path: item.path,
                        name: item.name,
                      })),
                };
              } catch (error) {
                return {
                  query,
                  items: [],
                  error:
                    error instanceof Error
                      ? error.message
                      : String(error),
                };
              }
            },
          ),
        );

      const codeSearchMs =
        Math.round(
          performance.now() -
            codeSearchStarted,
        );

      const searches = [
        ...treeSearches,
        ...remoteSearches,
      ];

      const searchMs = Math.round(
        performance.now() -
          searchStarted,
      );

      const searchErrors =
        searches
          .filter(
            (search) =>
              "error" in search &&
              search.error,
          )
          .map((search) => ({
            query: search.query,
            error: search.error,
          }));

      const scores =
        new Map<string, number>();

      // Jeśli query jawnie zawiera nazwę pliku/modułu,
      // taki plik musi wygrać z luźnymi trafieniami
      // występującymi w wielu ogólnych query.
      const explicitReferenceScores =
        new Map<string, number>();

      function explicitReferenceScore(
        filePath: string,
        query: string,
      ): number {
        const normalizedPath =
          filePath.toLowerCase();

        const basename =
          normalizedPath
            .split("/")
            .at(-1) ??
          normalizedPath;

        const stem =
          basename.replace(
            /\.[^.]+$/,
            "",
          );

        const normalizedQuery =
          query
            .trim()
            .toLowerCase();

        if (!normalizedQuery) {
          return 0;
        }

        // Dokładna nazwa pliku:
        // invoiceService.ts
        if (
          normalizedQuery === basename
        ) {
          return 10_000;
        }

        // Dokładna nazwa modułu bez rozszerzenia:
        // userService
        if (
          stem.length >= 6 &&
          normalizedQuery === stem
        ) {
          return 9_000;
        }

        // Query zawiera nazwę pliku:
        // "invoiceService.ts createInvoice"
        if (
          normalizedQuery.includes(
            basename,
          )
        ) {
          return 8_500;
        }

        // Query zawiera nazwę modułu + symbol:
        // userService.createUser
        if (
          stem.length >= 6 &&
          normalizedQuery.includes(
            stem,
          )
        ) {
          return 8_000;
        }

        return 0;
      }

      const matchedBy =
        new Map<
          string,
          Set<string>
        >();

      for (const search of searches) {
        search.items.forEach(
          (item, index) => {
            const positionScore =
              Math.max(
                1,
                50 - index,
              );

            scores.set(
              item.path,
              (scores.get(item.path) ??
                0) +
                positionScore,
            );

            const referenceScore =
              explicitReferenceScore(
                item.path,
                search.query,
              );

            explicitReferenceScores.set(
              item.path,
              Math.max(
                explicitReferenceScores.get(
                  item.path,
                ) ?? 0,
                referenceScore,
              ),
            );

            if (
              !matchedBy.has(
                item.path,
              )
            ) {
              matchedBy.set(
                item.path,
                new Set(),
              );
            }

            matchedBy
              .get(item.path)!
              .add(search.query);
          },
        );
      }

      const rankedCandidates = [
        ...scores.entries(),
      ]
        .map(([filePath, score]) => ({
          path: filePath,
          score,
          explicitReferenceScore:
            explicitReferenceScores.get(
              filePath,
            ) ?? 0,
          matchedBy: [
            ...(matchedBy.get(
              filePath,
            ) ?? []),
          ],
        }))
        .sort((a, b) => {
          // Jawna nazwa pliku/modułu z issue
          // ma pierwszeństwo przed ogólnym coverage.
          if (
            a.explicitReferenceScore !==
            b.explicitReferenceScore
          ) {
            return (
              b.explicitReferenceScore -
              a.explicitReferenceScore
            );
          }

          if (
            a.matchedBy.length !==
            b.matchedBy.length
          ) {
            return (
              b.matchedBy.length -
              a.matchedBy.length
            );
          }

          return b.score - a.score;
        });

      const selectedCandidates =
        rankedCandidates.slice(
          0,
          effectiveMaxFiles,
        );

      const selectedPaths =
        selectedCandidates.map(
          (candidate) =>
            candidate.path,
        );

      // Model wie o kolejnych trafieniach,
      // ale nie płacimy za ich kod.
      const otherCandidates =
        rankedCandidates
          .slice(
            effectiveMaxFiles,
            effectiveMaxFiles +
              MAX_REPORTED_CANDIDATES,
          )
          .map((candidate) => ({
            path: candidate.path,
            matchedBy:
              candidate.matchedBy,
            score: candidate.score,
            explicitReferenceScore:
              candidate.explicitReferenceScore,
          }));

      const readStarted =
        performance.now();

      const results =
        await Promise.all(
          selectedPaths.map(
            (filePath) =>
              readFileAtHead(filePath),
          ),
        );

      const readMs = Math.round(
        performance.now() -
          readStarted,
      );

      let usedChars = 0;

      let readableRemaining =
        results.filter(
          (file) =>
            "content" in file &&
            typeof file.content ===
              "string",
        ).length;

      const files = [];

      for (const file of results) {
        if (
          !("content" in file) ||
          typeof file.content !==
            "string"
        ) {
          files.push(file);
          continue;
        }

        const fileQueries = [
          ...(matchedBy.get(
            file.path,
          ) ?? []),
        ];

        const extracted =
          extractSearchSnippets(
            file.content,
            fileQueries,
            effectiveSearchMaxLinesPerFile,
          );

        const remaining =
          effectiveMaxChars -
          usedChars;

        if (remaining <= 0) {
          files.push({
            path: file.path,
            sha: file.sha,
            matchedBy:
              fileQueries,
            totalLines:
              extracted.totalLines,
            contentOmitted: true,
            reason:
              "Payload budget exhausted",
          });

          readableRemaining--;
          continue;
        }

        const fairShare = Math.min(
          remaining,
          Math.max(
            1_200,
            Math.floor(
              remaining /
                Math.max(
                  readableRemaining,
                  1,
                ),
            ),
          ),
        );

        const content =
          extracted.content.length >
          fairShare
            ? extracted.content.slice(
                0,
                fairShare,
              ) +
              "\n[TRUNCATED BY FAIR PAYLOAD BUDGET]"
            : extracted.content;

        usedChars += content.length;
        readableRemaining--;

        files.push({
          path: file.path,
          sha: file.sha,
          matchedBy: fileQueries,
          totalLines:
            extracted.totalLines,
          returnedLines:
            extracted.returnedLines,
          truncated:
            extracted.truncated ||
            content.length <
              extracted.content.length,
          content,
        });
      }

            return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                mode: "search",

                turnBudget: {
                  enforced:
                    turnBudget.enforced,
                  limit:
                    REPO_CODE_TURN_LIMIT,
                  used:
                    turnBudget.used,
                  remaining:
                    turnBudget.remaining,
                },

                repository:
                  `${repository.owner}/${repository.repo}`,

                branch:
                  repository.branch,

                head,

                queries:
                  effectiveQueries,

                searchTerms,

                omittedQueries,

                treeResolution: {
                  cacheHit:
                    treeCacheHit,
                  treeMs,
                  treeError,
                  resolvedTerms:
                    treeSearches.map(
                      (search) =>
                        search.query,
                    ),
                },

                codeSearch: {
                  terms:
                    remoteSearchTerms,
                  omittedTerms:
                    omittedRemoteSearchTerms,
                  maxTerms:
                    HARD_MAX_CODE_SEARCH_TERMS,
                  codeSearchMs,
                },

                candidateCount:
                  rankedCandidates.length,

                searchErrors,

                selectedPaths,

                otherCandidates,

                omittedCandidateCount:
                  Math.max(
                    0,
                    rankedCandidates.length -
                      selectedCandidates.length,
                  ),

                timing: {
                  searchMs,
                  readMs,
                  totalMs: Math.round(
                    performance.now() -
                      started,
                  ),
                },

                limits: {
                  requested: {
                    queries:
                      allQueries.length,
                    maxFiles,
                    maxLinesPerFile,
                    maxChars,
                  },

                  effective: {
                    queries:
                      effectiveQueries.length,
                    searchTerms:
                      searchTerms.length,
                    maxFiles:
                      effectiveMaxFiles,
                    maxLinesPerFile:
                      effectiveSearchMaxLinesPerFile,
                    maxChars:
                      effectiveMaxChars,
                  },

                  payloadChars:
                    usedChars,
                },

                files,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
