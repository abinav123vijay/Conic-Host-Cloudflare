# Cloudflare Pilot Test Report

## Executive summary

The local spike established OpenNext/Wrangler configuration, added the MongoDB request-context path, and verified the normal Next.js build and Node-based health/auth behavior. The Cloudflare Worker build did **not** complete: OpenNext stopped during Wrangler package loading under Node.js 20.9.0 on Windows, before producing a Worker bundle.

Consequently, no Worker bundle size, Worker CPU or memory use, direct MongoDB connectivity, Worker-level proxy/auth behavior, or Worker-level Excel behavior has been measured. This report does not claim that the application is ready for, or fits within, Cloudflare Workers Free.

No deployment was made, no production MongoDB connection was attempted, and no credentials were changed or exposed.

## 1. Files changed for the spike

- `.gitignore` — excludes environment variants (while retaining `.env.example`), generated OpenNext/Wrangler and build output, temporary files, and anchors the generated root `cloudflare-env.d.ts` ignore rule so the authored declaration at `types/cloudflare-env.d.ts` is not ignored.
- `package.json` and `package-lock.json` — add OpenNext/Wrangler and local preview/type-generation scripts.
- `next.config.ts` — initializes OpenNext's Cloudflare development integration.
- `open-next.config.ts` — adds the OpenNext Cloudflare adapter configuration.
- `wrangler.jsonc` — adds the local pilot Worker configuration, Node.js compatibility, a 10 ms CPU limit, and the non-secret pilot database name. It contains no MongoDB URI.
- `lib/mongodb.ts` — adds a Cloudflare binding-based database path scoped to OpenNext's request execution context; keeps the existing Node.js fallback.
- `types/cloudflare-env.d.ts` — declares the optional `MONGODB_URI` and `MONGODB_DB` bindings.
- `app/api/health/route.ts` — adds a public health response that does not access MongoDB.
- `tests/api-health.test.ts` and `tests/cloudflare-auth-pilot.test.ts` — add local tests for the health response, missing Worker URI binding, and auth/session/proxy logic with an isolated fake database.

`CLOUDFLARE_COMPATIBILITY_REASSESSMENT.md` predates this spike and was not changed. `tsconfig.tsbuildinfo` was already modified in the workspace before this work and was left untouched.

## 2. Dependencies and versions

Added and pinned:

| Package | Version |
|---|---:|
| `@opennextjs/cloudflare` | 1.20.2 |
| `wrangler` | 4.86.0 |

Installed versions verified locally:

| Component | Version |
|---|---:|
| Node.js | 20.9.0 |
| Next.js | 16.3.6 |
| React / React DOM | 19.3.0 |
| MongoDB Node.js driver | 6.21.0 |
| SheetJS `xlsx` | 0.20.3 |
| `jszip` | 3.10.2 |

Next.js, React, and the MongoDB driver were not upgraded. The installation emitted engine warnings for transitive packages requiring a later Node 20 release or Node 22.

## 3. Build and local development results

### Verified

- `npm run typecheck` passed.
- `npm run build` passed with Next.js 16.3.6.
- The normal `npm run dev` workflow started successfully on port 3001 because port 3000 was already occupied. The local health route returned HTTP 200 JSON; an unauthenticated protected API returned 401; and a protected page redirected with 307.
- The final targeted tests passed: 3 tests covering the MongoDB binding fail-closed behavior, public health response, and login/session/logout/proxy behavior with a fake database.

### Blocked / not verified

- `npm run preview` did not produce a Worker bundle. OpenNext warned that Windows support is limited, then failed while loading Wrangler with `ERR_IMPORT_ASSERTION_TYPE_MISSING` under Node.js 20.9.0.
- A Wrangler dry run could not proceed because `.open-next/worker.js` had not been generated.
- This was a tooling/runtime setup failure, not evidence that the application itself successfully builds for Workers or that the adapter is incompatible with the application.

## 4. MongoDB direct connection

### Implementation present

In the Worker path, `getDb()` reads `MONGODB_URI` from the Cloudflare environment binding, rejects a missing binding, and caches the in-flight database connection in a `WeakMap` keyed by OpenNext's request execution context. It does not use a process-global MongoDB client pool in that path. The existing global client behavior remains as a fallback when running outside Cloudflare context.

`wrangler.jsonc` contains only the non-secret `MONGODB_DB` pilot name. It has no URI or credential. The Worker binding test verified that a missing Cloudflare URI fails closed rather than falling back to a Node environment variable.

### Not tested

- No connection to MongoDB was attempted. Direct TCP/TLS compatibility, Atlas/network configuration, handshake behavior, query behavior, request-scoped connection lifetime, and latency are therefore unverified.
- No dedicated test database was created. A live test requires explicit approval to use a dedicated test database and the necessary Atlas/network configuration. Do not use the production URI or database for this test.
- No MongoDB URI or credential should be placed in `wrangler.jsonc` or logged; configure an approved test URI as a Worker secret only after approval.

The code path is adapted to the documented Cloudflare integration shape, but only a successful Worker preview and an approved, non-production connection test can establish runtime compatibility.

## 5. Authentication, sessions, and proxy

### Verified locally

The isolated auth test passed login, `HttpOnly` session-cookie creation, session validation, logout cookie clearing, allowed and denied role-based API access, unauthenticated API rejection, and protected-page redirect. The fake database is process-local test data; it does not access MongoDB.

The ordinary Next.js build compiled the existing `proxy.ts` path, and local development HTTP checks verified representative protection behavior.

### Not verified in Workers

These results do not execute the actual OpenNext Worker request pipeline. Worker cookie handling, proxy-to-Worker adaptation, Node.js crypto/runtime compatibility, and the end-to-end auth flow in `workerd` remain unverified. No authorization checks were removed or weakened.

## 6. Excel compatibility

### Existing behavior inspected

- Import uses `xlsx` to parse a request `File` through a `Buffer`, then persists parsed records.
- Export uses both `xlsx` and `jszip`, returns a Node buffer, and reads `data/templates/CONIC_Business_Tracker.xlsx` through `fs.readFileSync(path.join(process.cwd(), ...))`.
- The existing handlers explicitly select `runtime = 'nodejs'`.
- No Excel application source was changed.

### Local test result and Worker status

The targeted Node-based Excel regression selection had 9 passing tests and 1 failing test. The failure was the existing parser validation error: `Notes on Daily Sales & Expenses row 2 must be a valid number.` No change was made to the parser or test data to mask it.

Because the Worker bundle was not generated, the following are unverified: `xlsx`/`jszip` module compatibility in `workerd`, binary parsing and ZIP generation in that runtime, whether OpenNext includes the workbook template in its virtual filesystem/assets, and import/export CPU and memory consumption. The `process.cwd()`/`fs.readFileSync()` template access is a particular packaging/runtime item to test; no alternative template implementation was added without evidence that it is needed.

Import also performs database replacement operations. It was not invoked against any live database.

## 7. Bundle, CPU, and memory findings

| Measurement | Result |
|---|---|
| Compressed Worker bundle size | Not available; no bundle was generated. |
| CPU for dashboard/auth/Excel requests | Not measured in Workers. |
| Memory for dashboard/auth/Excel requests | Not measured in Workers. |
| MongoDB connection latency | Not measured; no database connection was attempted. |
| Worker dashboard response behavior | Not tested. |
| Worker auth/proxy behavior | Not tested. |
| Worker Excel import/export | Not tested. |

The Wrangler pilot configuration sets `cpu_ms` to 10, corresponding to the Free-plan CPU budget being evaluated. Network wait time for MongoDB is not itself CPU time; request handling, authentication/crypto, database result processing, dashboard aggregation/serialization, workbook parsing, ZIP/XML generation, and template processing do consume CPU.

Likely higher-risk operations are Excel import/export and any large dashboard calculation/result serialization. Authentication is expected to do less work than workbook processing, but has not been measured in Workers. MongoDB query latency alone is not enough to determine CPU fit. The Free-plan memory and script-size thresholds also require measurements against the generated Worker; neither has been checked.

## 8. Free-plan implications

The official Workers limits documentation describes the applicable Free-plan constraints, including the 10 ms CPU limit and 128 MB memory limit. The pilot config explicitly sets the 10 ms CPU ceiling, but no request has been measured against it. Since there is no bundle, compressed script size cannot be compared to the applicable Free upload limit either.

No conclusion that the app fits Workers Free can be drawn from the successful Next.js build or Node tests.

## 9. Remaining blockers and risks

1. **Worker build blocker:** OpenNext preview currently fails with Node.js 20.9.0 on Windows before bundle generation. Windows support is warned as limited, and the installation also reported newer Node engine requirements for transitive dependencies.
2. **Runtime evidence missing:** Worker-level build, bundle inspection, CPU/memory tests, auth/proxy checks, and Excel tests remain outstanding.
3. **MongoDB evidence missing:** No direct TCP/TLS connection or latency test was performed. An approved dedicated test database and appropriate Atlas/network settings are prerequisites.
4. **Excel packaging/runtime risk:** The workbook template is loaded from `process.cwd()` using `fs`; its inclusion and accessibility in the OpenNext Worker filesystem/assets have not been verified.
5. **Existing Excel test failure:** One local parser regression test fails on the noted invalid-number validation case; it should be investigated separately before treating the Excel behavior as fully validated.
6. **No production exercise:** No production deployment, production database access, or production data change occurred.

## 10. Recommended next stage

First unblock the local adapter toolchain, preferably using a supported Node.js 22+ environment or a compatible Linux/WSL environment, without changing production credentials or resources. Then rerun the OpenNext preview build and inspect the generated bundle and included template. If that succeeds, measure representative Worker requests for CPU and memory and test the Excel paths with safe fixture data.

Only after the local Worker build works should the MongoDB direct-connection test be considered. It requires your approval to use a dedicated test database and the corresponding Atlas/network setup; no database should be created or contacted without that approval. Keep the existing auth checks in place and verify them in the actual Worker preview.

**Status:** The limited configuration and local Node-based checks are complete; the Cloudflare runtime compatibility spike is blocked before Worker generation. This report is the stopping point. No deployment or production change was made.

## Official documentation

- [Cloudflare OpenNext guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)
- [Cloudflare MongoDB integration guide](https://developers.cloudflare.com/workers/databases/third-party-integrations/mongodb/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
