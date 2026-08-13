import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defineGraph,
  node,
  edge,
  safety,
  GraphRegistry,
  messagesValue,
  type GraphDefinition,
} from "@langgraph/toolkit";
import { LangGraphServiceProvider, StruxCheckpointer, scanAgents } from "../src/index.js";

interface State {
  messages: unknown[];
  done: boolean;
}

const agentDef = defineGraph<State>({
  name: "ping",
  state: {
    messages: messagesValue(),
    done: false as never,
  } as never,
  stateDefaults: { done: false as never },
  nodes: {
    start: node(async () => ({ done: true })),
  },
  entry: "start",
  edges: [edge("start", "END")],
  safety: safety(10),
});

describe("scanAgents (StruxJS convention scanner)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "strux-agents-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("discovers workflows whose index.js default-exports a GraphDefinition", async () => {
    const dir = join(root, "admin-chat");
    await mkdir(dir);
    // Write an ESM module that default-exports the plain definition.
    // Export the compiled graph under both shapes the scanner accepts:
    // default (definition with .name/.nodes) and named `graph`.
    await writeFile(join(dir, "index.js"), `import { compile, attachExecutor } from "@langgraph/toolkit";
const def = ${JSON.stringify(agentDef, (_k, v) => (typeof v === "function" ? undefined : v))};
def.nodes = { start: async () => ({ done: true }) };
const compiled = attachExecutor(compile(def));
export default def;
export const graph = compiled;
`);
    const results = await scanAgents(root);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("admin-chat");
    expect(results[0].definition?.name).toBe("ping");
    expect(results[0].error).toBeFalsy();
  });

  it("reports a missing directory as empty results", async () => {
    expect(await scanAgents(join(root, "nope"))).toEqual([]);
  });

  it("registers scanned definitions with a registry", async () => {
    const registry = new GraphRegistry();
    registry.register(agentDef);
    expect(registry.list()).toEqual(["ping"]);
  });
});

describe("StruxCheckpointer", () => {
  it("persists and retrieves checkpoints", async () => {
    const cp = new StruxCheckpointer();
    await cp.put({ threadId: "t1", checkpointId: "c1", state: { a: 1 }, node: "plan", round: 1 });
    await cp.put({ threadId: "t1", checkpointId: "c2", state: { a: 2 }, node: "confirm", round: 2 });
    expect((await cp.get("t1"))?.checkpointId).toBe("c2");
    expect((await cp.list("t1")).length).toBe(2);
    expect(await cp.get("unknown")).toBeNull();
  });
});

describe("LangGraphServiceProvider", () => {
  it("exposes StruxJS bindings and resolves a registry", () => {
    const provider = new LangGraphServiceProvider();
    expect(LangGraphServiceProvider.bindings).toContain("langgraph");
    expect(() => provider.resolve(new GraphRegistry())).not.toThrow();
    expect(provider.getRegistry().list()).toEqual([]);
  });
});
