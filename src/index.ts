/**
 * @langgraph-toolkit/adapter-struxjs
 *
 * StruxJS binding: ServiceProvider that registers a LangGraphManager,
 * convention-based AgentScanner over app/Agents/, a Strux-flavored
 * Checkpointer interface, SSE middleware, and console command classes.
 *
 * Host interfaces are declared locally so this package builds without
 * installing struxjs-core (peer dependency, resolved by the host app).
 */
import { readFileSync, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  Checkpoint,
  Checkpointer,
  CompiledGraph,
  GraphDefinition,
  GraphRegistry,
  JsonObject,
  JsonValue,
  RunOptions,
  ToolkitRuntime,
} from "@langgraph-toolkit/core";
import { createToolkitRuntime } from "@langgraph-toolkit/core";

// ---------- Host interfaces (StruxJS shapes, declared locally) ----------

/** Provider registration accepted by a StruxJS application. */
export type StruxProviderRegistration =
  | StruxServiceProviderShape
  | (new () => StruxServiceProviderShape);

/** Minimal StruxJS app shape needed to register this provider. */
export interface StruxApplication {
  registerProviders(providers: readonly StruxProviderRegistration[]): void;
  boot?(): Promise<void>;
}

/** Minimal StruxJS config driver shape. */
export interface StruxConfigDriver {
  get(key: string): JsonValue | undefined;
}

/** Minimal host shape needed to register this provider. */
export interface StruxServiceProviderShape {
  register(app: StruxApplication): void;
  boot?(app: StruxApplication): Promise<void>;
}

// ---------- Checkpointer ----------

/** In-memory StruxJS-flavored checkpointer for local development and tests. */
export class StruxCheckpointer implements Checkpointer {
  private store = new Map<string, Checkpoint[]>();

  async get(threadId: string): Promise<Checkpoint | null> {
    const list = this.store.get(threadId);
    if (!list || list.length === 0) return null;
    return list[list.length - 1];
  }

  async put(checkpoint: Checkpoint): Promise<void> {
    const list = this.store.get(checkpoint.threadId) ?? [];
    list.push(checkpoint);
    this.store.set(checkpoint.threadId, list);
  }

  async list(threadId: string): Promise<Checkpoint[]> {
    return [...(this.store.get(threadId) ?? [])];
  }
}

// ---------- AgentScanner ----------

/** A scanned workflow resource and its optional loading error. */
export interface ScanResult {
  /** Absolute path of the workflow directory (app/Agents/<name>). */
  path: string;
  /** Workflow name (directory name). */
  name: string;
  /** Graph definition loaded from <path>/index.js; null if absent or failing. */
  definition: GraphDefinition<JsonObject> | null;
  /** Runtime owned by a resource facade, when the module exports one. */
  runtime?: ToolkitRuntime;
  error?: Error;
}

interface ScannedResource {
  readonly graph: CompiledGraph<JsonObject>;
  readonly runtime: ToolkitRuntime;
}

type ScannedCandidate = GraphDefinition<JsonObject> | { readonly definition: GraphDefinition<JsonObject> } | ScannedResource;
interface ScannedModule {
  readonly default?: ScannedCandidate;
  readonly graph?: ScannedCandidate;
}

function isGraphDefinition(candidate: ScannedCandidate): candidate is GraphDefinition<JsonObject> {
  return "name" in candidate && "nodes" in candidate && "state" in candidate;
}

function isCompiledGraph(candidate: ScannedCandidate): candidate is { readonly definition: GraphDefinition<JsonObject> } {
  return "definition" in candidate;
}

function isScannedResource(candidate: ScannedCandidate): candidate is ScannedResource {
  return "graph" in candidate && "runtime" in candidate;
}

/**
 * Convention scanner: every directory inside agentsRoot containing an
 * index.js or index.ts that default-exports a GraphDefinition or compiled
 * graph becomes a registered workflow. index.ts support keeps tsx-based local
 * development faithful to the emitted Node ESM layout.
 */
export async function scanAgents(agentsRoot: string): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  if (!existsSync(agentsRoot)) return results;
  const entries = await readdir(agentsRoot);
  for (const entry of entries) {
    const fullPath = join(agentsRoot, entry);
    const s = await stat(fullPath).catch(() => null);
    if (!s?.isDirectory()) continue;
    const javascriptIndex = join(fullPath, "index.js");
    const typescriptIndex = join(fullPath, "index.ts");
    const indexPath = existsSync(javascriptIndex) ? javascriptIndex : typescriptIndex;
    let definition: GraphDefinition<JsonObject> | null = null;
    let runtime: ToolkitRuntime | undefined;
    let error: Error | undefined;
    if (indexPath.length > 0 && existsSync(indexPath)) {
      try {
        const mod = await import(indexPath) as ScannedModule;
        const candidate = mod.default ?? mod.graph;
        if (candidate && isScannedResource(candidate)) {
          definition = candidate.graph.definition;
          runtime = candidate.runtime;
        } else if (candidate && isGraphDefinition(candidate)) {
          definition = candidate;
        } else if (candidate && isCompiledGraph(candidate)) {
          definition = candidate.definition;
        } else {
          error = new Error("agent index does not export a GraphDefinition");
        }
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
      }
    }
    results.push({ path: fullPath, name: entry, definition, runtime, error });
  }
  return results;
}

/** Result of scanning and registering convention-based StruxJS graph resources. */
export interface ScanAndRegisterResult {
  readonly runtime: ToolkitRuntime;
  readonly results: readonly ScanResult[];
}

/**
 * Scan app/Agents, register every valid definition, and return one runtime
 * facade. Invalid candidates remain visible in `results` for diagnostics.
 */
export async function scanAndRegisterAgents(
  agentsRoot: string,
  runtime?: ToolkitRuntime,
): Promise<ScanAndRegisterResult> {
  const results = await scanAgents(agentsRoot);
  const targetRuntime = runtime ?? results.find((result) => result.runtime !== undefined)?.runtime ?? createToolkitRuntime();
  for (const result of results) {
    if (result.definition !== null && !targetRuntime.has(result.definition.name)) {
      if (result.runtime !== undefined && result.runtime !== targetRuntime) {
        const compiled = result.runtime.get(result.definition.name);
        if (compiled !== undefined && !targetRuntime.has(compiled.name)) targetRuntime.add(compiled);
      } else {
        targetRuntime.register(result.definition);
      }
    }
  }
  return { runtime: targetRuntime, results };
}

// ---------- ServiceProvider ----------

/** StruxJS ServiceProvider that exposes the graph registry under langgraph. */
export class LangGraphServiceProvider implements StruxServiceProviderShape {
  static readonly bindings = ["langgraph", "ai.llm"] as const;

  private registry: GraphRegistry | null = null;

  constructor(runtime?: ToolkitRuntime) {
    this.registry = runtime ?? null;
  }

  getRegistry(): GraphRegistry {
    if (!this.registry) throw new Error("LangGraphManager not bootstrapped yet");
    return this.registry;
  }

  register(_app: StruxApplication): void {
    void _app;
  }

  async boot(_app: StruxApplication): Promise<void> {
    void _app;
  }

  /** Host apps call this to resolve the registry from their container. */
  resolve(registry: GraphRegistry): void {
    this.registry = registry;
  }
}

// ---------- SSE middleware (Strux reply shape) ----------

/** Generic reply-like object accepted by streamGraphToReply. */
export interface StruxReply {
  setHeader?(name: string, value: string): void;
  write?(chunk: string): boolean | void;
  end?(): void;
  raw?: { write(chunk: string): void; end(): void };
}

/** Serialize an SSE event block using the shared host format. */
export function encodeSseEvent(type: string, data: object | JsonValue): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Stream graph step events to a Strux reply-like object. */
export async function streamGraphToReply(
  registry: GraphRegistry,
  graphName: string,
  reply: StruxReply,
  input: JsonObject,
  opts?: Pick<RunOptions, "threadId" | "signal">,
): Promise<void> {
  if (!registry.has(graphName)) {
    reply.write?.(encodeSseEvent("error", { message: `Graph "${graphName}" not registered` }));
    reply.end?.();
    return;
  }
  reply.setHeader?.("Content-Type", "text/event-stream");
  reply.setHeader?.("Cache-Control", "no-cache");
  const writer = reply.raw ?? reply;
  try {
    const events = registry.stream(graphName, input, opts);
    for await (const event of events) {
      writer.write?.(encodeSseEvent(event.type, event));
      if (event.type === "error" || event.type === "cancelled") break;
    }
  } catch (err) {
    writer.write?.(encodeSseEvent("error", { message: err instanceof Error ? err.message : "Graph stream failed" }));
  } finally {
    writer.end?.();
  }
}

// ---------- Console commands ----------

/** Strux console command: `strux langgraph:scan`. */
export class ScanAgentsCommand {
  static readonly signature = "langgraph:scan";
  static readonly description = "Scan app/Agents/ and list registered workflows";

  async handle(agentsRoot: string): Promise<ScanResult[]> {
    return scanAgents(agentsRoot);
  }
}

/** Strux console command: `strux langgraph:list`. */
export class ListGraphsCommand {
  static readonly signature = "langgraph:list";
  static readonly description = "List compiled graphs in the registry";

  handle(registry: GraphRegistry): string[] {
    return registry.list();
  }
}

/** Load a small .env-style key=value file without adding a runtime dependency. */
export function loadDotenv(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, "utf8");
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}
