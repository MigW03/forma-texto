# Decision: n8n vs. Server Code for the Document Processing Pipeline

**Date:** 2026-05-31
**Status:** Recommended — move the pipeline into the server. (Pending final go-ahead.)
**Context:** The document formatting/proofreading pipeline was originally built entirely in n8n — from text extraction through processed-file upload back to Supabase, including AI calls, file handling, file-extension editing, and zip extraction/compression into a `.docx`. The question: keep building in n8n, or move the pipeline into the existing Express server as TypeScript code?

---

## The core insight first

n8n's superpower is **wiring together APIs with little or no code** — "when a row hits this table, send a Slack message, then create a Trello card." Visual, fast, no deployment.

But this pipeline is, at almost every step, custom code: unzip a file, surgically edit XML, chunk text, call an AI, merge results by index, re-zip, upload. We're already writing Code nodes for all of it. So we pay n8n's *costs* (binary-handling quirks, browser-based editing, dependency allow-lists, another service to run) without collecting its main *benefit* (not having to write code). That mismatch is the heart of this decision.

---

## Side-by-side summary

| Dimension | n8n | Server code (existing Express app) |
|---|---|---|
| **File/zip handling** | Awkward — base64 in memory, binary passing quirks, workarounds | Native — Buffers, fflate, streams. No friction |
| **AI calls (chunk/merge)** | Loop Over Items + sub-workflows; fiddly | Plain loop with the SDK; merge logic is ~10 lines |
| **Maintainability** | Logic spread across nodes; hard to version, test, refactor | Plain TypeScript files; diffable, testable, refactorable |
| **AI-assisted dev** | Assistant can't see/edit nodes — everything transcribed | Assistant writes and edits the code directly |
| **Deployment** | A second service to host, secure, back up, upgrade | Already deployed — just more files |
| **Security** | Another system holding the Supabase service key | One trust boundary; secrets already there |
| **Triggering** | Easy (webhook/cron UI) | Also easy — call a function after payment |
| **Long-running jobs** | Decoupled from web request "for free" | Must add a background job/queue (the one real gap) |
| **Observability** | Great *visual* run history out of the box | Add logging/error tracking (standard, but DIY) |
| **Scalability** | Queue mode exists but must be configured; memory ceiling on big files | Full control via a worker queue; finer-grained |
| **Cost** | Cloud subscription, or self-host + upkeep | Marginal — uses existing server |

---

## The reasoning, dimension by dimension

**File handling — biggest factor, favors code.**
A `.docx` is a zip, and n8n's binary/base64 handling between nodes is clumsy; you end up building workarounds. In Node, `fflate` unzips and re-zips a docx in a few lines, working with normal Buffers. The thing fighting us today simply disappears.

**AI calls and the split/merge logic — favors code.**
The chunk-and-merge design (split paragraphs into batches, send each to the AI, merge results back by paragraph index) is *naturally* a loop over an array. In code that's a `for` loop or a `Promise` pool with a concurrency cap — roughly 30 lines. In n8n it becomes the "Loop Over Items + sub-workflow + re-attach metadata" dance, the most error-prone part of n8n. Code also gives full control of structured AI output and retries.

**Maintainability and AI-assisted development — strongly favors code.**
The goal is to have code written for us rather than troubleshoot nodes by hand. n8n workflows live as large JSON blobs that don't diff well in git, can't be unit-tested easily, and can't be read or edited by an AI assistant — every node would have to be described back. With code in the repo, the assistant writes it, we review it, git tracks it, and each transform can be tested in isolation.

**Deployment and security — favors code.**
We already run an Express server (auth, checkout, webhooks, email). Adding the pipeline there means **one** thing to deploy and **one** place the Supabase service-role key lives. n8n is a whole extra service to host, patch, secure, and back up — and a second copy of sensitive credentials.

**Triggering — roughly a tie.**
n8n makes triggers visual and easy. But there's already a Stripe webhook handler; triggering the pipeline from code is just "call this function when payment succeeds." No cross-service hop needed.

**Long-running jobs — the one place n8n genuinely helps.**
A 50-page document with AI calls takes minutes. That must **never** run inside a normal web request (it would time out). n8n gives this decoupling automatically — jobs run in its own worker, separate from web traffic. Code-only requires adding this: a **background job queue**. The clean option that needs no extra infrastructure is **pg-boss**, a queue that runs on the Postgres database already provided by Supabase. So the gap is real but small and well-solved.

**Observability — favors n8n, but not decisive.**
n8n's visual execution history (see each step's input/output, replay failures) is genuinely nice for debugging *flow*. In code this is replicated with logging, an error tracker (e.g. Sentry), and a `processing_stage` column. More setup, but standard and arguably more powerful once in place.

**Scalability — favors code, with effort either way.**
n8n holds all data in memory between nodes, so very large files can hit a memory ceiling, and scaling means configuring "queue mode" with Redis workers. In code, concurrency is controlled precisely (process N documents at once, stream large files) — more power, but built by us.

---

## Recommendation

**Move the pipeline into the server code.** For this workload the reasoning is one-sided: it's code-heavy and file-heavy (n8n's weak spots), it benefits enormously from AI-assisted development (impossible inside n8n), and the existing server and database absorb the new work with no extra infrastructure. The only thing n8n provided for free — background execution — is replaced cleanly by **pg-boss on the existing Postgres**.

Keep n8n for what it's great at: lightweight integrations and automations where writing/deploying code isn't wanted (e.g. "email me when a project sits unprocessed for an hour"). Just not as the engine for document processing.

Honest caveat: there is real, working effort already invested in the n8n flow, and rebuilding has a cost. But the migration is mostly *moving logic already figured out* into cleaner files — not redesigning it — and every future change gets easier, not harder.

---

## Rough processing flow — each approach

### If staying on n8n
```
Webhook (projectId)
  → Get project row (Supabase)
  → Download .docx (Storage)
  → Unzip → document.xml + styles.xml         [Code node]
  → Step A: styles, strip overrides, margins   [Code nodes]
  → Step B: detect + format references          [Code nodes]
  → Chunk references → Loop → AI → merge by range   [Loop + sub-workflow]
  → Chunk headings   → Loop → AI → merge by index   [Loop + sub-workflow]
  → Re-zip into .docx                            [Code node]
  → Upload to Storage → Update DB status         [HTTP / Supabase nodes]
```
Splitting/merging lives in Code nodes feeding "Loop Over Items," with a re-attach step to keep each chunk's index — the fiddly part.

### If moving to the server (recommended)
```
Stripe webhook confirms payment
  → enqueue job { projectId }                 (pg-boss, on existing Postgres)

Background worker picks up the job:
  → fetch project row + download .docx          (existing Supabase client)
  → unzip → document.xml + styles.xml           (fflate)
  → deterministic transforms                    (pure functions: styles, margins,
                                                 strip overrides, references)
  → AI passes:
       chunkBlocks(paragraphs)                  → array of chunks
       run chunks through AI                    (concurrency-limited Promise pool)
       applyDecisions(originalXml, results)     → merge by index
  → re-zip → .docx                              (fflate)
  → upload to Storage + stamp status=ready      (existing Supabase client)
  → send "ready" email                          (Resend — already wired)

Frontend polls the project row and shows the status badge (already built).
```
Here splitting and merging are just functions — `chunkBlocks()` returns an array, `applyDecisions()` walks the original XML and rewrites paragraph styles by index. No loop nodes, no metadata re-attaching, fully unit-testable.

---

## Suggested first step (low-risk)

Port the deterministic transforms (styles/margins/strip-overrides logic already drafted in `n8nResources/nodes/`) into a plain TypeScript module in the server, with a unit test — no AI, no queue, just proof that the file-editing works in code. Evaluate how it feels before committing further.
