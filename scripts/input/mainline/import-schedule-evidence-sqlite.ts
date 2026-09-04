import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import {
  DEFAULT_SCHEDULE_EVIDENCE_CACHE_ROOT,
  resolveScheduleEvidenceCacheRoot,
} from "../../reconcile/consumer/one-hop/schedule-evidence-cache.ts";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const IMPORTABLE_EXTENSIONS = new Set([".json", ".sql"]);

export interface ImportScheduleEvidenceOptions {
  readonly cacheRoot?: string;
  readonly databasePath?: string;
}

export interface ImportScheduleEvidenceResult {
  readonly databasePath: string;
  readonly taskDirectories: number;
  readonly filesSeen: number;
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly invalid: number;
}

interface EvidenceRow {
  readonly taskId: string;
  readonly evidenceType: string;
  readonly direction: string;
  readonly depth: number;
  readonly format: "json" | "sql";
  readonly observedAt: string;
  readonly contentSha256: string;
  readonly payloadJson: string | null;
  readonly payloadText: string | null;
  readonly sourcePath: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function parseDirection(fileName: string, parsed: Record<string, unknown> | null): string {
  const fromPayload = nonEmptyString(parsed?.direction);
  if (fromPayload === "up" || fromPayload === "down") return fromPayload;
  if (fileName.includes("-up-")) return "up";
  if (fileName.includes("-down-")) return "down";
  return "";
}

function parseDepth(fileName: string, parsed: Record<string, unknown> | null): number {
  const fromPayload = parsed?.depth;
  if (typeof fromPayload === "number" && Number.isInteger(fromPayload) && fromPayload >= 0) {
    return fromPayload;
  }
  const match = /-depth-(\d+)\./u.exec(fileName);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

function readEvidenceRow(taskId: string, fileName: string, taskPath: string): EvidenceRow | null {
  const extension = extname(fileName).toLowerCase();
  if (!IMPORTABLE_EXTENSIONS.has(extension)) return null;
  const sourcePath = join(taskPath, fileName);
  const raw = readFileSync(sourcePath, "utf8");
  const baseName = basename(fileName, extension);

  if (extension === ".sql") {
    return {
      taskId,
      evidenceType: baseName,
      direction: "",
      depth: 0,
      format: "sql",
      observedAt: "",
      contentSha256: sha256(raw),
      payloadJson: null,
      payloadText: raw,
      sourcePath,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const documentHash = nonEmptyString(record.content_sha256);
  return {
    taskId,
    evidenceType: baseName,
    direction: parseDirection(fileName, record),
    depth: parseDepth(fileName, record),
    format: "json",
    observedAt: nonEmptyString(record.observed_at ?? record.observedAt),
    contentSha256: documentHash || sha256(raw),
    payloadJson: JSON.stringify(record),
    payloadText: null,
    sourcePath,
  };
}

function initializeDatabase(databasePath: string): DatabaseSync {
  mkdirSync(resolve(databasePath, ".."), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 30000;

    CREATE TABLE IF NOT EXISTS task_inventory (
      task_id TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS evidence (
      task_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT '',
      depth INTEGER NOT NULL DEFAULT 0,
      format TEXT NOT NULL CHECK (format IN ('json', 'sql')),
      observed_at TEXT NOT NULL DEFAULT '',
      content_sha256 TEXT NOT NULL,
      payload_json TEXT,
      payload_text TEXT,
      source_path TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY (task_id, evidence_type, direction, depth),
      FOREIGN KEY (task_id) REFERENCES task_inventory(task_id)
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_type
      ON evidence(evidence_type);
    CREATE INDEX IF NOT EXISTS idx_evidence_task
      ON evidence(task_id);
  `);
  return database;
}

export function importScheduleEvidenceToSqlite(
  options: ImportScheduleEvidenceOptions = {},
): ImportScheduleEvidenceResult {
  const cacheRoot = resolve(options.cacheRoot ?? DEFAULT_SCHEDULE_EVIDENCE_CACHE_ROOT);
  const scheduleEvidenceRoot = resolveScheduleEvidenceCacheRoot(cacheRoot);
  const tasksRoot = join(scheduleEvidenceRoot, "tasks");
  if (!existsSync(tasksRoot)) throw new Error(`CACHE_TASKS_ROOT_MISSING:${tasksRoot}`);
  const databasePath = resolve(
    options.databasePath ??
      join(scheduleEvidenceRoot, "tasks-sqlite", "schedule-evidence.sqlite"),
  );
  const database = initializeDatabase(databasePath);
  const insertTask = database.prepare(
    "INSERT INTO task_inventory(task_id) VALUES (?) ON CONFLICT(task_id) DO NOTHING",
  );
  const findExisting = database.prepare(
    `SELECT content_sha256 AS contentSha256 FROM evidence
     WHERE task_id = ? AND evidence_type = ? AND direction = ? AND depth = ?`,
  );
  const upsertEvidence = database.prepare(`
    INSERT INTO evidence(
      task_id, evidence_type, direction, depth, format, observed_at,
      content_sha256, payload_json, payload_text, source_path, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, evidence_type, direction, depth) DO UPDATE SET
      format = excluded.format,
      observed_at = excluded.observed_at,
      content_sha256 = excluded.content_sha256,
      payload_json = excluded.payload_json,
      payload_text = excluded.payload_text,
      source_path = excluded.source_path,
      imported_at = excluded.imported_at
  `);

  let taskDirectories = 0;
  let filesSeen = 0;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let invalid = 0;
  const importedAt = new Date().toISOString();

  database.exec("BEGIN");
  try {
    for (const taskEntry of readdirSync(tasksRoot, { withFileTypes: true })) {
      if (!taskEntry.isDirectory() || !TASK_ID_PATTERN.test(taskEntry.name)) continue;
      taskDirectories++;
      const taskId = taskEntry.name;
      const taskPath = join(tasksRoot, taskId);
      insertTask.run(taskId);
      for (const fileEntry of readdirSync(taskPath, { withFileTypes: true })) {
        if (!fileEntry.isFile() || !IMPORTABLE_EXTENSIONS.has(extname(fileEntry.name).toLowerCase())) {
          continue;
        }
        filesSeen++;
        try {
          const row = readEvidenceRow(taskId, fileEntry.name, taskPath);
          if (row === null) {
            invalid++;
            continue;
          }
          const existing = findExisting.get(
            row.taskId,
            row.evidenceType,
            row.direction,
            row.depth,
          ) as { readonly contentSha256?: unknown } | undefined;
          if (nonEmptyString(existing?.contentSha256) === row.contentSha256) {
            unchanged++;
            continue;
          }
          upsertEvidence.run(
            row.taskId,
            row.evidenceType,
            row.direction,
            row.depth,
            row.format,
            row.observedAt,
            row.contentSha256,
            row.payloadJson,
            row.payloadText,
            row.sourcePath,
            importedAt,
          );
          if (existing === undefined) inserted++;
          else updated++;
        } catch {
          invalid++;
        }
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    throw error;
  }
  database.close();
  return {
    databasePath,
    taskDirectories,
    filesSeen,
    inserted,
    updated,
    unchanged,
    invalid,
  };
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1]?.endsWith("import-schedule-evidence-sqlite.ts")) {
  const result = importScheduleEvidenceToSqlite({
    cacheRoot: option(process.argv.slice(2), "--cache-root"),
    databasePath: option(process.argv.slice(2), "--database-path"),
  });
  console.log(JSON.stringify(result));
}
