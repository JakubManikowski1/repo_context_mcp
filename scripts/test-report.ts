import {
  spawnSync,
} from "node:child_process";

type Suite =
  Readonly<{
    label: string;
    script: string;
  }>;

type Result =
  Readonly<{
    suite: Suite;
    status:
      | "PASS"
      | "FAIL"
      | "SKIP";
    durationMs: number;
    stdout: string;
    stderr: string;
  }>;

const suites:
  readonly Suite[] = [
    {
      label:
        "Typecheck",
      script:
        "typecheck",
    },
    {
      label:
        "Tool surface",
      script:
        "test:surface",
    },
    {
      label:
        "Connection crypto",
      script:
        "test:crypto",
    },
    {
      label:
        "Connection store",
      script:
        "test:store",
    },
    {
      label:
        "Repository resolver",
      script:
        "test:resolver",
    },
    {
      label:
        "Repository selection",
      script:
        "test:selection",
    },
    {
      label:
        "MCP tool isolation",
      script:
        "test:isolation",
    },
    {
      label:
        "Provider revocation",
      script:
        "test:provider-revoke",
    },
    {
      label:
        "Operator reveal",
      script:
        "test:operator-reveal",
    },
    {
      label:
        "Operator MFA",
      script:
        "test:operator-mfa",
    },
    {
      label:
        "Auth boundary",
      script:
        "test:auth",
    },
    {
      label:
        "OAuth resource server",
      script:
        "test:resource-auth",
    },
    {
      label:
        "JWT verifier",
      script:
        "test:jwt-auth",
    },
    {
      label:
        "OAuth server mode",
      script:
        "test:oauth-server",
    },
    {
      label:
        "GitHub connector",
      script:
        "test:connect",
    },
    {
      label:
        "GitHub OAuth flow",
      script:
        "test:connect-oauth",
    },
    {
      label:
        "GitHub selection",
      script:
        "test:connect-selection",
    },
    {
      label:
        "GitHub installation selection",
      script:
        "test:connect-installation-selection",
    },
    {
      label:
        "GitHub connect HTTP router",
      script:
        "test:connect-http",
    },
    {
      label:
        "GitHub connect server E2E",
      script:
        "test:connect-server-e2e",
    },
  ];

const npmCommand =
  process.platform === "win32"
    ? "npm.cmd"
    : "npm";

function duration(
  milliseconds: number,
): string {
  return (
    `${(
      milliseconds /
      1000
    ).toFixed(1)}s`
  );
}

function resultLine(
  result: Result,
): string {
  const icon =
    result.status === "PASS"
      ? "✅"
      : result.status === "FAIL"
        ? "❌"
        : "⏭️";

  const label =
    result.suite.label
      .padEnd(
        36,
        " ",
      );

  const elapsed =
    result.status === "SKIP"
      ? "-"
      : duration(
          result.durationMs,
        );

  return (
    `${icon} ${label} ${elapsed}`
  );
}

function normalizeOutput(
  value:
    string | null | undefined,
): string {
  return (
    value ??
    ""
  ).trim();
}

const results:
  Result[] = [];

let failed = false;

const startedAt =
  process.hrtime.bigint();

console.log();
console.log(
  "Repository Context MCP — test report",
);
console.log();

for (
  const suite
  of suites
) {
  if (failed) {
    const result:
      Result = {
        suite,
        status:
          "SKIP",
        durationMs: 0,
        stdout: "",
        stderr: "",
      };

    results.push(
      result,
    );

    console.log(
      resultLine(
        result,
      ),
    );

    continue;
  }

  const suiteStartedAt =
    process.hrtime.bigint();

  const child =
    spawnSync(
      npmCommand,
      [
        "run",
        "--silent",
        suite.script,
      ],
      {
        encoding:
          "utf8",

        env:
          process.env,
      },
    );

  const suiteFinishedAt =
    process.hrtime.bigint();

  const durationMs =
    Number(
      suiteFinishedAt -
      suiteStartedAt,
    ) /
    1_000_000;

  const stdout =
    normalizeOutput(
      child.stdout,
    );

  const stderr =
    normalizeOutput(
      child.stderr,
    );

  const passed =
    child.status === 0 &&
    child.error === undefined;

  const result:
    Result = {
      suite,

      status:
        passed
          ? "PASS"
          : "FAIL",

      durationMs,
      stdout,
      stderr,
    };

  results.push(
    result,
  );

  console.log(
    resultLine(
      result,
    ),
  );

  if (!passed) {
    failed = true;

    console.log();
    console.log(
      "----- failing suite output -----",
    );

    if (stdout) {
      console.log(
        stdout,
      );
    }

    if (stderr) {
      if (stdout) {
        console.log();
      }

      console.error(
        stderr,
      );
    }

    if (child.error) {
      if (
        stdout ||
        stderr
      ) {
        console.log();
      }

      console.error(
        child.error,
      );
    }

    console.log(
      "----- end failing suite output -----",
    );
    console.log();
  }
}

const finishedAt =
  process.hrtime.bigint();

const totalMs =
  Number(
    finishedAt -
    startedAt,
  ) /
  1_000_000;

const passedCount =
  results.filter(
    (result) =>
      result.status ===
        "PASS",
  ).length;

const failedCount =
  results.filter(
    (result) =>
      result.status ===
        "FAIL",
  ).length;

const skippedCount =
  results.filter(
    (result) =>
      result.status ===
        "SKIP",
  ).length;

console.log();
console.log(
  "────────────────────────────────────────────────",
);

console.log(
  `PASS  ${passedCount}/${suites.length}`,
);

console.log(
  `FAIL  ${failedCount}/${suites.length}`,
);

if (
  skippedCount > 0
) {
  console.log(
    `SKIP  ${skippedCount}/${suites.length}`,
  );
}

console.log(
  `TOTAL ${duration(totalMs)}`,
);

console.log(
  "────────────────────────────────────────────────",
);

console.log();

if (
  failedCount > 0
) {
  process.exitCode = 1;
}
