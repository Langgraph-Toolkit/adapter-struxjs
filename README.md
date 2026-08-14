# @langgraph-toolkit/adapter-struxjs

StruxJS lifecycle adapter for Langgraph-Toolkit. It registers graph providers during application bootstrap, scans agent folders, and streams graph events through a Strux-compatible reply object.

## Install

```bash
npm install struxjs @langgraph-toolkit/core @langgraph-toolkit/adapter-struxjs
```

## Provider lifecycle

```ts
import {
  LangGraphServiceProvider,
  scanAndRegisterAgents,
} from "@langgraph-toolkit/adapter-struxjs";

const provider = new LangGraphServiceProvider(runtime);
provider.register(app);
await scanAndRegisterAgents("./app/Agents", provider.getRegistry(), runtime);
await provider.boot(app);
```

The adapter also exports `scanAgents`, `ScanAgentsCommand`, `ListGraphsCommand`, `streamGraphToReply`, `encodeSseEvent`, `StruxCheckpointer`, `loadDotenv`, and the typed Strux service-provider contracts. The scanner expects each agent folder to export a graph definition or runtime resource rather than a framework-specific singleton.

## HTTP and checkpoint support

`streamGraphToReply` writes `text/event-stream` headers and serializes step, tool, interrupt, and terminal events. `StruxCheckpointer` is a deterministic in-memory checkpointer for local development. Production applications can inject a checkpointer from the checkpointer adapter package.

## Development

```bash
npm install
npm run build
npm test
```

The Strux example is scaffolded with the StruxJS CLI and includes `bootstrap.ts`, `.env.example`, `app/Agents/database-chat`, and lifecycle tests.

## License

MIT
