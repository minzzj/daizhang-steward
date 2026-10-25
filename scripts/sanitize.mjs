// Sanitize local absolute paths before evidence files are copied into the repository.
// Keeps the evidence bundle publishable (no C:\Users\..., no H:\minzzj..., no temp worktrees).
// Handles both plain text logs and JSON-escaped backslashes (H:\\minzzj...).

import { readFileSync, writeFileSync } from "node:fs";

export function makeSanitizer(root) {
  const rootWin = root.replaceAll("/", "\\");
  const rootPosix = root.replaceAll("\\", "/");
  const rootJson = JSON.stringify(rootWin).slice(1, -1); // H:\\minzzj\\...
  const rootPosixJson = JSON.stringify(rootPosix).slice(1, -1);

  return function sanitize(text) {
    let out = text;
    // repo root, in every escaping variant
    out = out.split(rootWin).join(".");
    out = out.split(rootPosix).join(".");
    out = out.split(rootJson).join(".");
    out = out.split(rootPosixJson).join(".");
    // temporary git worktrees: C:\Users\...\Temp\steward-wt-...
    out = out.replace(/[A-Za-z]:\\{1,2}Users\\{1,2}[^"\r\n]*?steward-wt-[^"\r\n\\/]*/gi, "<worktree>");
    // any other local user path
    out = out.replace(/[A-Za-z]:\\{1,2}Users\\{1,2}[^"\r\n]+/gi, "<local-path>");
    // staging/build directories
    out = out.replace(/[A-Za-z]:\\{1,2}daizhang-build\\{1,2}[^"\r\n]+/gi, "<staging-path>");
    return out;
  };
}

export function sanitizeFileInPlace(file, sanitize) {
  try {
    const text = readFileSync(file, "utf8");
    const clean = sanitize(text);
    if (clean !== text) writeFileSync(file, clean, "utf8");
  } catch {
    /* binary or unreadable: leave as-is */
  }
}
