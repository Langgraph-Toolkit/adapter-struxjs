# @langgraph-toolkit/adapter-struxjs

**Use StruxJS lifecycle conventions without coupling the graph to StruxJS.** The adapter registers graph providers during bootstrap, scans agent folders, and streams graph events through a Strux-compatible reply object.

## Install

```bash
npm install struxjs-core @langgraph-toolkit/core @langgraph-toolkit/adapter-struxjs
```

## Zero-config factory

```ts
import { createStruxJSAdapter } from "@langgraph-toolkit/adapter-struxjs";
import { resource } from "./resource.js";

const adapter = createStruxJSAdapter(resource.runtime);

adapter.provider.register(app);
await adapter.provider.boot(app);
```

The factory returns `{ graph, runtime, provider }`. The provider preserves the StruxJS registration and lifecycle hooks while the graph resource remains reusable by other hosts.

## Scanner and native escape hatches

For folder discovery, use `registerAgents` and export a ready resource as the folder default export. For custom routing or contributor tooling, use `scanAgents` from `/scanner`, `streamReply` from the root, command classes from `/commands`, `loadDotenv` from `/dotenv`, and `StruxCheckpointer` from `/checkpointer`.

```ts
import { registerAgents, streamReply } from "@langgraph-toolkit/adapter-struxjs";
import { scanAgents } from "@langgraph-toolkit/adapter-struxjs/scanner";
```

StruxJS owns application bootstrap and provider registration. Core owns state, nodes, edges, gates, interrupts, and typed events. MCP, Community, and persistence remain independent boundaries.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
