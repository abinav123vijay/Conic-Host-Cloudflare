# Cloudflare Compatibility Reassessment

**Status:** Documentation-only technical reassessment. No application code was changed, packages were not installed or upgraded, and nothing was deployed.

## Executive summary and corrections

The original audit was too categorical about MongoDB: Cloudflare now documents the official MongoDB Node.js driver running directly in Workers, as well as a Durable Object pattern for retaining a warm MongoDB connection. MongoDB connectivity is therefore **technically viable**, subject to adapting this app's connection lifecycle and verifying the complete application in the Workers runtime.

This is not a drop-in deployment. The main risks are the current global MongoDB client cache, the Next.js `proxy.ts` authentication gate, Excel processing under the Free CPU/memory and bundle limits, and packaging the workbook template for Workers' virtual filesystem.

The installed versions resolved in `package-lock.json` are Next.js **16.3.6**, React **19.3.0**, and MongoDB driver **6.21.0**. The manifest declares ranges beginning at Next.js `^16.3.0` and React `^19.2.0`. The local Node.js version observed during the audit is **20.9.0**; it is not the runtime version used by Workers.

## 1. MongoDB compatibility

### Official support and prerequisites

Cloudflare's [MongoDB integration guide](https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/) explicitly demonstrates the official `mongodb` Node.js driver connecting directly to a MongoDB cluster from a Worker. It states that the driver uses `node:net` and `node:tls`, available with Node.js compatibility and a compatibility date of `2025-03-20` or later. A current compatibility date (from `2026-08-04`) enables Node.js compatibility by default.

The guide also says Hyperdrive does **not** support MongoDB; it supports PostgreSQL and MySQL wire protocols. MongoDB connectivity here means the driver opens TCP/TLS sockets from Workers, not a Hyperdrive connection.

### Actual `lib/mongodb.ts`

[`lib/mongodb.ts`](./lib/mongodb.ts) holds both `MongoClient` and `Db` in `globalThis`, creates a client once per isolate, and returns the cached database thereafter. This is appropriate for a conventional long-lived Node process, but it does not implement Cloudflare's documented direct-connection lifecycle: Cloudflare says ordinary Worker requests cannot reuse I/O objects across requests, so driver pooling does not work in a plain Worker.

The module can be adapted, but the current global cache must not be treated as a reliable cross-request connection pool. A Worker implementation should obtain bindings/secrets through the Cloudflare/OpenNext request context and use a request-scoped connection pattern consistent with the MongoDB guide. A direct connection has an approximate **300 ms TCP/TLS connection overhead per Worker invocation** in Cloudflare's guide; this is wall-clock latency, not 300 ms of Worker CPU.

### A. Direct connection from the Worker

- **Compatibility:** Officially documented. The least invasive MongoDB option.
- **Changes needed:** Replace reliance on cross-request `globalThis` connection reuse; wire `MONGODB_URI` and `MONGODB_DB` as Cloudflare environment configuration; test driver behavior, TLS, Atlas networking, and all query patterns in Workers.
- **Performance:** Each invocation makes a new TCP/TLS connection; Cloudflare gives roughly 300 ms overhead as an example. The network wait itself does not count against the CPU limit.
- **Free-plan cost/limits:** No Durable Object charges. Worker Free has 100,000 requests/day and 10 ms CPU/request. MongoDB Atlas charges/limits are separate. A single app request that uses one client for several database operations still pays one connection setup, rather than one setup per individual query, if connection lifecycle is implemented at request scope.
- **Best fit:** A low-traffic initial deployment where that connection latency is acceptable.

### B. Connection reuse through a Durable Object

Cloudflare's guide puts the `MongoClient` inside a Durable Object (DO). It reports roughly **35 ms on warm requests** and notes that the DO can reuse the connection. The DO may be evicted after approximately 70–140 seconds without traffic; TCP connections do not survive hibernation, so a later cold request reconnects.

This is not a transparent pool around the existing `getDb()` API. MongoDB objects such as `MongoClient`, `Db`, and `Collection` cannot be returned to the calling Worker via RPC. Database operations must execute inside the DO. The app's data-access code therefore needs to be moved behind serializable DO methods, preferably with each route's related database work batched into a bounded RPC call.

Free-plan DOs must use the SQLite storage backend. Free includes **100,000 DO requests/day** and **13,000 GB-s/day** of DO duration; exceeding a Free allocation causes further operations of that type to fail. Every RPC method call is billed as a DO request. DO duration is wall-clock time while the object is active, so time spent waiting on MongoDB can affect duration charges even though it is not Worker CPU time. The DO's SQLite row/storage quotas matter only if the app also uses DO storage; MongoDB query traffic is not SQLite row usage.

On the Workers Paid plan, the cited DO pricing page includes 1 million requests/month and 400,000 GB-s/month, then lists **$0.15/million requests** and **$12.50/million GB-s** beyond those allocations. MongoDB/Atlas costs remain separate. A single shared DO also introduces a serialization and availability concentration point; Cloudflare describes roughly 1,000 requests/second per DO as a soft limit.

## 2. Next.js and application compatibility

The official [OpenNext for Cloudflare guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/) documents App Router, Route Handlers, React Server Components, SSR, and other Next.js features. OpenNext's [Cloudflare-specific support page](https://opennext.js.org/cloudflare) says all minor and patch versions of Next.js 16 are supported, which includes the locked Next.js **16.3.6**. It also says OpenNext runs the Next.js Node.js runtime on Workers.

That does **not** mean Workers implement every Node.js API. Cloudflare's [Node.js compatibility documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) distinguishes native support from partial support and import-only shims. Relevant APIs in this repository:

- `node:crypto`: Cloudflare documents it as fully supported (with listed algorithm exceptions that do not include the HMAC, random bytes, timing-safe comparison, or scrypt operations used by [`lib/auth.ts`](./lib/auth.ts)). Password hashing still needs CPU benchmarking on Free.
- `Buffer`, `node:util`, and `node:path`: documented as supported.
- `node:net` and `node:tls`: the MongoDB integration guide specifically documents their use by the MongoDB driver. TLS APIs are described as partially supported in the general Node API table, so test the exact driver/TLS path rather than extrapolating from imports.
- `node:fs`: available as a **virtual in-memory filesystem**, not a normal host filesystem. See Excel findings below.

The app's standard App Router pages and API Route Handlers are within the documented feature set. Most app API routes use ordinary Next request/response APIs and MongoDB calls; the two Excel handlers explicitly request `runtime = 'nodejs'`, which fits OpenNext's Node-runtime model. Auth uses signed HttpOnly cookies and stateless HMAC session tokens, which are portable in principle if the same dedicated secret is configured consistently. Set `AUTH_SESSION_SECRET` explicitly rather than relying on the current fallback to `MONGODB_URI`.

**Proxy/authentication remains an important compatibility check.** The app's [`proxy.ts`](./proxy.ts) performs authentication and role gating for pages and API paths, importing `node:crypto` through `lib/auth.ts`. OpenNext's support table says middleware is supported but **Node.js middleware is not yet supported**. Next.js 16 calls the convention `proxy`; the current Next.js docs say Proxy runs before routes and should not rely on shared globals. Do not assume the middleware entry in the OpenNext feature table proves this exact Next 16 `proxy.ts` implementation works. Build and exercise redirects, cookie checks, role gates, and protected APIs in the Workers preview before choosing the deployment.

Cloudflare's current OpenNext guide recommends **vinext for new Next.js applications** and describes OpenNext as the path for maintaining an existing OpenNext application. This repository is already a Next.js app; OpenNext remains a supported candidate, but its proxy/runtime and workload checks are still required.

## 3. Excel import/export compatibility

The inspected files are [`lib/excel/parse.ts`](./lib/excel/parse.ts), [`lib/excel/export.ts`](./lib/excel/export.ts), [`app/api/excel/import/route.ts`](./app/api/excel/import/route.ts), and [`app/api/excel/export/route.ts`](./app/api/excel/export/route.ts). The routes use `xlsx` and `jszip`; import buffers the upload and parses it with `XLSX.read`, while export reads the workbook template, fetches business datasets, edits worksheet/chart XML, and calls `JSZip.generateAsync({ type: 'nodebuffer' })`.

Neither Cloudflare nor OpenNext documents a blanket guarantee for these exact dependency versions and these workload sizes. The libraries may bundle and execute under Workers' Node.js compatibility, but a Workers preview is needed to verify their module resolution, compression/binary behavior, and final bundle size.

The template is a separate runtime concern: export currently calls `fs.readFileSync(path.join(process.cwd(), 'data/templates/CONIC_Business_Tracker.xlsx'))`. Workers' `node:fs` reads included bundle files from a virtual read-only `/bundle` filesystem; it does not expose the normal deployment filesystem layout. The template must be included in the Worker bundle and the path/access method must be proven in preview. The current `process.cwd()`-relative path is not a confirmed match for that VFS.

Free-plan constraints materially affect Excel:

- Cloudflare's domain-level Free request-body limit is **100 MB**, but that is only an ingress ceiling, not a safe workbook size for this code.
- The Worker isolate memory limit is **128 MB**. Import first parses multipart form data, obtains an `ArrayBuffer`, creates a `Buffer`, then builds an XLSX workbook model and parsed records. These simultaneous representations can use several times the uploaded file size and may exhaust memory well below 100 MB.
- XLSX parsing, workbook construction, many XML rewrites/regex passes, and ZIP compression/decompression are CPU work. A complex or large workbook may exceed 10 ms of CPU; network waits and MongoDB latency do not count as CPU, but do not reduce this CPU work.
- OpenNext's Cloudflare guide states a stricter compressed Worker bundle-size limit of **3 MiB on Free** (10 MiB on Paid). Next.js, MongoDB, XLSX/JSZip, and the bundled template all contribute. The final compressed build size is not known without an OpenNext build.
- Cloudflare does not impose a response-body size limit, but response generation still uses isolate memory and CPU.

Therefore Excel is **not categorically incompatible**, and it should not be moved to another service before measurement. It is the highest-risk Free-tier workload and must be tested with the actual template and representative largest expected data/import files, recording CPU time, memory behavior, and compressed Worker size. If it does not fit, evaluate a paid CPU limit or a separate processing boundary then.

## 4. CPU, memory, and request assessment

Cloudflare's [Workers limits page](https://developers.cloudflare.com/workers/platform/limits/) (updated Oct. 29, 2026) states:

| Limit | Workers Free | Relevance here |
|---|---:|---|
| Requests | 100,000/day | Counts page/API traffic; DO requests have their own allocation. |
| CPU per HTTP request | 10 ms | CPU execution only; DB/network waiting is excluded. |
| Memory | 128 MB per isolate | Includes JS heap/WASM and can be shared by concurrent requests in that isolate. |
| Subrequests | 50/request | Keep in mind for Worker/service/asset fetches; Mongo TCP commands are not Fetch subrequests. |
| Simultaneous outgoing connections | 6/request | Relevant to concurrent network operations. |
| Incoming body size on a Free domain | 100 MB | Too high to treat as a safe buffered XLSX size. |
| OpenNext compressed bundle | 3 MiB | Separate, stricter OpenNext Free limit. |

Likely CPU hotspots, in descending concern:

1. **Excel import/export:** synchronous workbook parsing, workbook model creation, XML transformations, and ZIP processing are per-request CPU-heavy and may exceed 10 ms even though the MongoDB wait does not.
2. **Password signup/login:** `scrypt` is intentionally CPU-intensive. Its exact Workers CPU accounting and latency for the current default parameters must be measured; the Cloudflare Node crypto API support is not a promise that it fits the Free CPU budget.
3. **Dashboard calculations:** [`lib/dashboard/metrics.ts`](./lib/dashboard/metrics.ts) loads full daily and purchase histories, filters/sorts arrays, and repeatedly calls balance calculations over those histories for each day of the selected month. CPU depends on dataset size. MongoDB query latency is wall-clock waiting, not CPU.
4. **SSR and serialization:** route rendering and JSON response serialization can consume CPU; profile actual pages rather than treating all request duration as CPU.

The more urgent dashboard risk may be data volume and memory: the dashboard code reads full histories into arrays and performs in-memory calculations. This can pressure the 128 MB isolate limit even when CPU remains under 10 ms.

## 5. Architecture options

| Option | Compatibility | Complexity / maintenance | Cost and Free-tier implications | Existing functionality |
|---|---|---|---|---|
| **A. OpenNext Worker + direct MongoDB** | Official MongoDB driver support and Next 16 OpenNext support exist. Current global connection reuse needs replacement. Proxy, Atlas networking, Node API details, and Excel require preview validation. | **Lowest** Cloudflare migration complexity. Retain most server-side business logic; adapt env/connection lifecycle and template packaging. Direct connection setup adds about 300 ms/invocation in the guide's example. | Workers Free's 100k/day and 10 ms CPU limits apply; no DO charges. Atlas cost is separate. Free bundle cap is 3 MiB. | Best chance to preserve all routes and business logic with localized runtime changes, if preview and workload benchmarks pass. |
| **B. OpenNext Worker + MongoDB Durable Object** | Official MongoDB connection reuse pattern. Technically compatible, but database calls must execute in the DO; `Db` and collections cannot cross RPC. | **Highest** within Cloudflare: refactor all MongoDB access behind DO methods, design serialized inputs/results, handle DO lifecycle, errors, concurrency and location. More maintenance and possible central bottleneck. | Free: 100k DO calls/day and 13k GB-s/day; each RPC method is a request, active duration includes external DB waiting. Beyond Free, DO pricing applies. SQLite-backed DO required on Free. | Can preserve business semantics, but requires broad changes to how all API/business code accesses persistence. Can reduce warm connection latency to ~35 ms; cold starts still reconnect. |
| **C. Hybrid OpenNext app + separate Node.js backend** | Conventional Node backend supports current MongoDB pool and Node APIs; Worker calls backend over HTTP/service binding. | **Highest overall architecture complexity**: split API/persistence boundary, authenticate service calls, manage deployments/secrets/networking, and keep contracts synchronized. | Adds a separately billed Node service/hosting/database network path; Cloudflare Free limits still apply to the frontend Worker. | Strongest fallback for Excel or runtime features that fail Worker testing, but requires a deliberate API split. Do not adopt preemptively. |

## 6. Exact remaining blockers and risks

1. **No Cloudflare/OpenNext configuration is present in the inspected app manifest/config.** A compatibility/preview build has not been run, and the final OpenNext Worker bundle size is unknown.
2. **The global MongoDB client is not a supported cross-request pool in a plain Worker.** Choose request-scoped direct connections or a full DO persistence boundary.
3. **Next 16 `proxy.ts` compatibility is unverified.** OpenNext documents Node.js middleware as unsupported; this app's proxy is security-critical.
4. **Atlas network access must be checked.** Confirm the cluster can securely accept Worker egress connections without opening access more broadly than necessary, and verify any required network/egress arrangement.
5. **The workbook template is not yet mapped to Workers VFS.** Its bundle inclusion and runtime path must be tested.
6. **Free-tier performance is unknown.** Excel CPU/memory, scrypt CPU, large dashboard histories, and the 3 MiB compressed bundle require measurements on realistic data.
7. **Cloudflare secrets/bindings need explicit configuration.** At minimum, verify `MONGODB_URI`, `MONGODB_DB`, business/auth configuration, and a dedicated `AUTH_SESSION_SECRET` in the OpenNext runtime and build contexts.

## 7. Recommendation and next implementation stage

**Recommended architecture to test first: Option A (OpenNext + direct MongoDB), conditionally.** It is now explicitly supported by Cloudflare's MongoDB integration guide, and it makes the fewest changes to this app's persistence/business layer. The ~300 ms connection setup may be acceptable for low-volume business use, while avoiding a major DO refactor and DO request/duration accounting. This is a pilot recommendation, not a production compatibility sign-off.

**Recommended next stage, after approval:** a bounded compatibility spike, not a full migration:

1. Add the approved OpenNext/Workers configuration and run the adapter preview build; record the compressed bundle size.
2. Validate the `proxy.ts` login/logout/session and role-gating paths in Workers preview.
3. Exercise a small representative MongoDB read/write using the official direct-connection pattern and verify Atlas connectivity and secrets.
4. Run representative dashboard calculations, signup/login scrypt, Excel import, and export in preview; record CPU time and memory at realistic and upper-bound data sizes.
5. Choose Option B only if direct connection latency is unacceptable and the DO refactor plus its free/paid request and duration economics are acceptable. Choose Option C only if a required API/runtime or measured workload cannot be made viable on Workers.

No application implementation has started. This reassessment document is the only requested deliverable; work should stop here pending approval.

## Official references

- [Cloudflare: MongoDB integration for Workers](https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/)
- [Cloudflare: OpenNext adapter](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)
- [OpenNext: Cloudflare adapter, supported Next.js versions/features](https://opennext.js.org/cloudflare)
- [Cloudflare: Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Cloudflare: Node.js crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)
- [Cloudflare: Node.js filesystem / Workers VFS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)
- [Next.js: `proxy.ts` convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Cloudflare: Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare: Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
