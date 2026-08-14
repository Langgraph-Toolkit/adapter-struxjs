# @langgraph-toolkit/adapter-struxjs

**Use StruxJS lifecycle conventions without coupling the graph to StruxJS.** This adapter registers graph providers during application bootstrap, scans agent folders, and streams graph events through a Strux-compatible reply object.

## Install

```bash
npm install struxjs-core @langgraph-toolkit/core @langgraph-toolkit/adapter-struxjs
```

## Provider lifecycle

```ts
import {
  LangGraphServiceProvider,
  registerAgents,
} from "@langgraph-toolkit/adapter-struxjs";

const provider = new LangGraphServiceProvider(runtime);
provider.register(app);
await registerAgents("./app/Agents", provider.getRegistry(), runtime);
await provider.boot(app);
```

The scanner accepts either a plain graph definition or a resource facade. For a resource facade, export the ready resource as the folder's default export so the scanner can preserve its `ToolkitRuntime`, MCP gateway, model registry, and lifecycle ownership:

```ts
import { createDatabaseChatResource } from "./resource.js";

const databaseChat = await createDatabaseChatResource();
export default databaseChat;
```

It does not require a framework-specific singleton, and the resource can be reused by another host adapter.

## Why the structure stays portable

| Concern | StruxJS adapter | Core or resource |
|---|---|---|
| Application bootstrap and provider registration | Yes | No |
| Agent folder scanning | Yes | No |
| SSE or reply serialization | Yes | No |
| State, nodes, edges, gates, interrupts | No | Core |
| MCP, model, policy, checkpoint defaults | No | Resource/runtime |

The root adapter surface keeps application lifecycle small: `registerAgents` and `streamReply`, together with the typed service-provider contracts. Advanced concerns use explicit subpaths: `scanAgents` from `@langgraph-toolkit/adapter-struxjs/scanner`, command classes from `/commands`, `loadDotenv` from `/dotenv`, and `StruxCheckpointer` from `/checkpointer`. This keeps the common import readable while preserving extension points for contributors.

```ts
import { registerAgents, streamReply } from "@langgraph-toolkit/adapter-struxjs";
import { scanAgents } from "@langgraph-toolkit/adapter-struxjs/scanner";
import { StruxCheckpointer } from "@langgraph-toolkit/adapter-struxjs/checkpointer";
```

## HTTP and checkpoint support

`streamReply` writes `text/event-stream` headers and serializes step, tool, interrupt, thinking, token, and terminal events. `StruxCheckpointer` is a deterministic in-memory checkpointer for local development. Production applications can inject a driver from `@langgraph-toolkit/adapter-checkpointers`.

## Development

```bash
npm install
npm run build
npm test
```

Start a host from the official CLI with `npx create-struxjs-app database-chat`, then add the adapter and the resource from `examples/projects/strux`.

## License

MIT
