import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defineGraph,
  node,
  edge,
  safety,
  messagesValue,
} from "@langgraph-toolkit/core/legacy";
import type { ChatMessage, GraphDefinition } from "@langgraph-toolkit/core";
import { GraphRegistry } from "@langgraph-toolkit/core/runtime";
import { scanAgents } from "../src/scanner.js";
import { StruxCheckpointer } from "../src/checkpointer.js";
import { createStruxJSAdapter, LangGraphServiceProvider } from "../src/internal.js";

interface State {
  messages: readonly ChatMessage[];
  done: boolean;
}

const agentDef = defineGraph<State>({
  name: "ping",
  state: {
    messages: messagesValue(),
    done: false,
  },
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
    // The fixture intentionally has no package import because it is loaded
    // from a temporary directory outside the test workspace. Export the
    // compiled graph shape as metadata only; scanner behavior is the subject.
    await writeFile(join(dir, "index.js"), `
const def = ${JSON.stringify(agentDef, (_k, v) => (typeof v === "function" ? undefined : v))};
def.nodes = { start: async () => ({ done: true }) };
export default def;
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

  it("creates a provider resource from an existing registry", () => {
    const registry = new GraphRegistry();
    const adapter = createStruxJSAdapter(registry);
    expect(adapter.runtime.list()).toEqual([]);
    expect(adapter.provider.getRegistry()).toBe(adapter.runtime);
    expect(adapter.providerClass).toBeTypeOf("function");
  });
});
