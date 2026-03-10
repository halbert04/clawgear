# ClawGear TDD: Critical Review & Recommended Changes

**Date:** 2026-03-09
**Purpose:** Challenge every major decision in the TDD based on research into production agent systems, academic literature, and real-world failure modes.

---

## The Core Verdict

> **The TDD is architected like a secure infrastructure system (blockchain, PKI). But multi-agent AI systems are fundamentally quality assurance and learning systems. The hard problem is not tamper-proofing the audit log -- it is making agents produce good work and get better over time.**

The TDD has three critical gaps and several over-engineered areas:

| Category | TDD Status | Actual Importance |
|---|---|---|
| Security infrastructure (Merkle, Ed25519, taint) | Over-specified, 16 layers | 9 layers essential, 7 deferrable |
| Quality assurance (eval, reflection, peer review) | **Almost entirely absent** | THE most important subsystem |
| Learning & evolution (procedural memory, optimization) | **Completely absent** | What makes the system improve over time |
| Business orchestration (org chart, budgets, checkout) | Well-designed | Keep as-is with enhancements |
| Context & memory | Partially addressed | Major gaps in structure and cross-agent sharing |
| Tech stack (Rust kernel) | Over-engineered | LLM latency is 99% of execution time; Rust optimizes the wrong 1% |
| Scope | Massive (11 crates, 6 TS packages, 3 apps, 20+ channels) | Ship one thing well first; scope kills projects |
| Execution topology (CEO->CTO->Engineer) | Anti-pattern for execution | Keep hierarchy for governance, use flat orchestrator for work |

---

## 1. BIGGEST GAP: No Quality System

### The Problem

The TDD has zero mechanisms for ensuring agent output quality. It has:
- Budget enforcement (stops spending, not bad work)
- Approval gates (humans manually check -- defeats autonomy)
- Merkle audit (proves what happened after the fact)
- Loop guards (detects infinite loops, not quality problems)

### What Must Be Added: Quality Gate System

```
Agent produces output
  -> Self-Reflection (agent critiques its own work against rubrics)
  -> Peer Review (manager agent reviews, using org hierarchy)
  -> Quality Gate (judge model + per-role rubrics, automated)
  -> Pass: accept output, transition issue status
  -> Fail: send back with specific feedback for revision
```

**Components:**

**a) LLM-as-Judge Quality Gates**
- A `QualityGate` runs after every heartbeat output, before issue status transitions
- Configurable rubrics per role and task type
- Uses a dedicated judge model call (can be cheaper model)
- Failed outputs get sent back for revision with specific feedback
- Graduated response: minor issues -> agent self-fixes; major issues -> escalate to manager

**b) Self-Reflection Step in Heartbeat**
- Before posting results, every agent asks itself: "Does this meet the acceptance criteria? What could be wrong?"
- Structured self-critique, not freeform "is this good?"
- Stored as part of the run record for later analysis
- Cost: ~5-10% additional tokens per heartbeat. Worth it.

**c) Peer Review via Hierarchy**
- The `reportsTo` relationship should include quality review
- CTO agent reviews engineer agent's code before issue is marked done
- Not on every heartbeat -- on status transitions to `in_review` -> `done`
- The org chart already exists; use it for quality, not just delegation

**d) Deterministic Output Validators**
- For structured outputs: JSON Schema validation
- For code outputs: actually run tests (the ultimate quality gate)
- For documents: assertion-based checks ("must contain X", "must not exceed Y words")
- Regression testing against known-good baselines

**New database table:**
```
quality_evaluations
  id, companyId, issueId, runId, agentId,
  evaluatorType (self|peer|judge|deterministic),
  evaluatorAgentId (nullable),
  rubricId, scores (JSONB),
  passed (boolean), feedback (text),
  createdAt
```

### Impact: This is the #1 missing feature. Without it, humans are the only quality check, and the system can never be truly autonomous.

---

## 2. BIGGEST GAP: No Learning System

### The Problem

The TDD describes agents that execute from static configurations (agent.toml), static skills (SKILL.md), and static system prompts. There is no mechanism for agents to get better at their jobs over time. The heartbeat_runs data, approval decisions, and quality outcomes are stored but never used to improve future performance.

### What Must Be Added: Learning & Adaptation System

**a) Post-Run Reflection (Reflexion pattern)**

After every heartbeat, the agent writes a structured reflection:
```json
{
  "taskType": "code-review",
  "approach": "Reviewed auth module for security vulnerabilities",
  "whatWorked": "Checking OWASP Top 10 systematically caught 3 issues",
  "whatFailed": "Missed a timing attack vector in the token comparison",
  "lesson": "Always check for constant-time comparison when reviewing auth code",
  "outcome": "partial_success",
  "confidence": 0.7
}
```

Stored in a shared `lessons_learned` table (PostgreSQL, not per-agent SQLite) so ALL agents in the company can benefit.

**b) Experience-Indexed Memory Retrieval**

Before each heartbeat, retrieve relevant lessons from past runs:
```sql
SELECT lesson, outcome, confidence
FROM lessons_learned
WHERE company_id = $1
  AND task_type = $2
  AND outcome IN ('success', 'partial_success')
ORDER BY confidence DESC, created_at DESC
LIMIT 5;
```

Inject these into the heartbeat context: "Here is what the team has learned about tasks like this..."

**c) Skill Evolution (Voyager pattern)**

Agents can create and refine their own SKILL.md files based on accumulated experience:
1. After N successful runs of a particular pattern, the agent proposes a new skill
2. The skill goes through the approval gate
3. Approved skills are added to the company's skill library
4. Other agents can discover and use them

This is how procedural memory works -- agents accumulate "how to do X" knowledge.

**d) Prompt Optimization Pipeline (DSPy-inspired)**

After accumulating sufficient heartbeat data (e.g., 100+ runs):
1. Collect successful vs. failed runs with their prompts and outputs
2. Use successful runs as few-shot examples
3. Optimize the heartbeat procedure prompt against quality gate scores
4. A/B test the optimized prompt (10% of tasks) before full rollout
5. Auto-rollback if quality regresses

This turns ClawGear from "agents that run" into "agents that improve."

**e) Competence Tracking**

Per agent, per task type, track:
- Success rate (quality gate pass rate)
- Average cost per task
- Average time per task
- Trend (improving, stable, degrading)

Use this for:
- Graduated autonomy (reduce approval requirements as competence increases)
- Task routing (assign tasks to the most competent available agent)
- Curriculum learning (start with simple tasks, graduate to complex ones)

**New database tables:**
```
lessons_learned
  id, companyId, agentId, runId, issueId,
  taskType, approach, whatWorked, whatFailed,
  lesson (text), outcome, confidence (float),
  embedding (vector), createdAt

agent_competence
  id, companyId, agentId, taskType,
  totalRuns, successfulRuns, failedRuns,
  avgCostCents, avgDurationMs,
  qualityTrend (improving|stable|degrading),
  autonomyLevel (supervised|semi_auto|auto),
  updatedAt

prompt_versions
  id, companyId, agentRole, promptType (heartbeat|system|skill),
  version, content (text),
  evaluationScore (float), isActive (boolean),
  parentVersionId, createdAt
```

### Impact: This is what separates "a sophisticated RAG system" from "an actual agent operating system." Without learning, ClawGear gets worse over time (as the world changes and static prompts become stale), not better.

---

## 3. CRITICAL GAP: Memory Architecture Flaws

### 3a) SQLite-per-Agent Fragmentation

**Problem:** When Agent A discovers something valuable, Agent B cannot access it. SQLite databases are agent-local by design.

**Fix:** Move shared knowledge to PostgreSQL with pgvector:
- Agent-local SQLite: session transcripts, working files, scratch data
- Shared PostgreSQL: lessons learned, company knowledge, entity facts, embeddings (via pgvector)
- Keep the dual-DB concept but move the boundary

### 3b) Compaction Treated as Solved

**Problem:** LLM-based summarization is lossy. Critical details get lost. The TDD doesn't specify when to compact or how to handle the loss.

**Fix:** Adopt the MemGPT/Letta paging pattern:
- Agent explicitly manages its own context via `memory_store` and `memory_retrieve` calls
- Compaction is graceful degradation, not the primary memory strategy
- Structured memory extraction (typed facts, decisions, learnings) instead of freeform summarization
- Always-present core context: agent identity, current task, goal constraints, recent tool results -- never compacted

### 3c) Knowledge Graphs Underspecified

**Problem:** "Graph-based fact linking across agent interactions" is a hand-wave. LLM-generated knowledge graphs are noisy, expensive (~$50-500/day in extraction costs for 50 agents), and stale.

**Fix:** Replace with a typed fact store:
```
facts
  id, companyId, agentId, factType (decision|entity|relationship|observation),
  subject, predicate, object,
  confidence (float), source (run_id or issue_id),
  validFrom, invalidatedAt,
  createdAt
```

The organizational graph (org chart, goals, projects) is already modeled relationally in PostgreSQL. That IS the knowledge graph for organizational data.

### 3d) No Procedural Memory

**Problem:** The TDD covers semantic memory (embeddings, search) and working memory (context window) but has no mechanism for agents to remember "how to do things." Every heartbeat starts from the same static skills.

**Fix:** The skill evolution system described in Section 2c above. Plus: structured episode storage (`{situation, action, outcome, learning}`) as described in the CoALA framework.

### 3e) Goal Ancestry Over-Applied

**Problem:** Including the full goal ancestry in every heartbeat wastes tokens for low-level tasks. An engineer implementing a specific function doesn't need "Company Mission: Revolutionize B2B SaaS" in context.

**Fix:** Tiered injection:
- CEO/CTO: full ancestry with strategic context
- Team leads: their goal + one level up
- Individual agents: their immediate goal + actionable constraints (budget remaining, deadline, dependencies)
- Deep ancestry: available on-demand via `goal_ancestry_retrieve()`, not injected by default

Transform ancestry into actionable constraints:
```
Budget: $450 remaining (of $1000).
Deadline: March 15.
Quality bar: must pass integration tests.
Dependency: auth system must be compatible with API gateway (Agent Y).
```
This is more useful than "Mission: revolutionize B2B SaaS."

---

## 4. OVER-ENGINEERING: Security Reprioritization

### Current: 16 Layers, All in Phase 3

### Recommended: 3 Tiers Based on Actual Threat Models

**Tier 1 -- Must Have for V1 (Phase 1-2):**

| # | Layer | Why |
|---|---|---|
| 1 | WASM Sandbox (fuel + epoch) | Prevents runaway computation from untrusted code |
| 2 | RBAC Capability Gates | Core trust model -- kernel-enforced, not prompt-enforced |
| 3 | Subprocess Sandbox (env_clear + argv) | Prevents shell injection, the highest-probability attack |
| 4 | Prompt Injection Defense | The #1 real-world attack on agent systems. **NEEDS MORE DESIGN.** |
| 5 | Budget Enforcement + Auto-Pause | Real financial risk with real impact |
| 6 | Approval Gates | Core governance mechanism |
| 7 | Security Headers | Table stakes for any web application |
| 8 | SSRF Protection | Standard for any system making HTTP requests |
| 9 | Loop Guard (enhanced) | Prevents stuck agents burning budget |

**Tier 2 -- V2 (after core works):**

| # | Layer | Why |
|---|---|---|
| 10 | Taint Tracking | Valuable for data flow control, complex to implement |
| 11 | DM/Group Policies | Depends on deployment model (channels) |
| 12 | Docker Sandboxing | For multi-tenant / untrusted sessions |

**Tier 3 -- V3 / If Needed:**

| # | Layer | Why |
|---|---|---|
| 13 | Merkle Hash-Chain | Only needed for regulatory compliance -- append-only log is sufficient otherwise |
| 14 | Ed25519 Manifest Signing | Only needed when GearHub marketplace launches (Phase 7) |
| 15 | P2P Mutual Auth (OFP) | Only needed for multi-instance deployments |
| 16 | Secret Zeroization | Low-probability threat for most deployments |

### The Under-Specified Critical Layer: Prompt Injection Defense

The TDD lists "Prompt Injection Scanner" as one of 16 layers with almost no design detail. This is the #1 real-world attack on agent systems. It needs its own section:

1. **Input sanitization**: All external data (web scrapes, API responses, user messages) must be sanitized before entering agent context. Delimiters, system prompt markers, and override patterns must be escaped.
2. **Output filtering**: Agent responses must be scanned for data exfiltration patterns (encoded data, URLs to attacker-controlled servers).
3. **Tool call validation**: Is the agent calling tools it should be calling? Do the arguments make sense for the current task? Anomaly detection on tool call patterns.
4. **Context isolation**: Untrusted inputs go in a separate context section clearly marked as user data, not system instructions. Dual-LLM pattern: one model processes untrusted input, another decides actions.

---

## 5. ARCHITECTURE CHALLENGES

### 5a) Rust Kernel: The Hardest Question

This is the most consequential decision in the TDD and the research is split.

**The case AGAINST Rust (from production agent system analysis):**

The dominant latency in any agent system is LLM API calls (1-30 seconds per call). A kernel that boots in 180ms vs 500ms optimizes a cost that is <1% of total execution time. What production agent companies actually ship with:

| Company | Stack | Why They Won |
|---|---|---|
| Devin (Cognition) | Python | Agent architecture, not kernel speed |
| Factory | Python + TypeScript | Orchestration logic |
| Cursor | TypeScript | IDE integration, speed of iteration |
| LangGraph | Python (TS SDK) | Graph patterns, ecosystem |
| AutoGen | Python | Production multi-agent patterns |
| OpenAI Agents SDK | Python | Simplicity |

The dual-language architecture creates enormous complexity: two build systems, two test frameworks, two dependency ecosystems, a serialization boundary. Rust portions could be written in Go and achieve 90% of performance benefits with 50% of development cost.

**The case FOR Rust:**
- WASM sandbox genuinely benefits from Rust (Wasmtime is Rust-native)
- Memory safety for untrusted code execution is a real advantage
- Single binary deployment simplifies ops
- OpenFang proved it works at 137K lines with zero clippy warnings
- 40MB idle / 180ms cold start IS a genuine differentiator for desktop deployment (Tauri)

**Our recommendation: Pragmatic hybrid.**

The TDD already proposes Rust + TypeScript. The question is where to draw the line. Rather than "Rust for the entire kernel", consider:

| Component | Language | Rationale |
|---|---|---|
| Sandbox runtime (WASM + subprocess) | **Rust** | Genuine safety advantage, Wasmtime is native |
| Crypto operations (Merkle, Ed25519) | **Rust** | Performance matters here |
| Desktop shell (Tauri) | **Rust** | Required by Tauri |
| Kernel orchestration logic | **TypeScript or Go** | LLM-latency-dominated; iteration speed matters more |
| API server | **TypeScript or Go** | Ecosystem, hiring pool, speed of iteration |
| Channel adapters | **TypeScript** | All SDKs are JS/TS |
| Dashboard | **TypeScript** | Obvious |

This gives you Rust where it matters (sandbox, crypto, desktop) and a faster-iteration language where LLM latency dominates. The key insight: **the kernel is mostly making HTTP calls to LLM APIs and PostgreSQL. Rust's performance advantage is wasted on network I/O.**

**Decision needed:** This is genuinely the hardest call. Going full Rust (like OpenFang) is defensible if the team has Rust expertise and values the single-binary story. Going hybrid is defensible if shipping speed matters more. The wrong choice is Rust-for-everything with a team that's learning Rust on the job.

### 5a-original) Rust + TypeScript Bridge

Regardless of the kernel language choice, TypeScript is the pragmatic choice for:
- Channel adapters (SDKs are all in JS/TS)
- Web dashboard
- Skill processing
- Rapid iteration on business logic

**The risk:** The REST/WS bridge between Rust and TypeScript adds latency and failure modes. Keep the boundary clean: Rust owns the kernel, TypeScript owns the UI and channel adapters. Never cross the bridge for hot-path operations.

### 5b) Heartbeat vs. Event-Driven: Hybrid Is the Answer

**The TDD's heartbeat model is correct for the business orchestration use case.** Paperclip proved it works. But pure heartbeat has limitations:

- **For business tasks (issue work, strategy, reports):** Heartbeat is ideal. Agents wake, check work, act, sleep. Efficient, predictable, budgetable.
- **For real-time interactions (chat, channel messages):** Heartbeat adds unacceptable latency. When a customer messages on Slack, waiting for the next heartbeat interval is not acceptable.
- **For monitoring and alerts (Hands, triggers):** Event-driven is better. Continuous polling wastes resources.

**Recommendation:** Hybrid model:
- Heartbeat for scheduled work processing (the Paperclip model)
- Event-driven for real-time interactions (channel messages trigger immediate agent wake)
- Continuous for autonomous Hands (they run their own loops with sleep intervals)

The TDD partially describes this (wakeup requests can come from "assigned, mentioned, scheduled, manual") but should make the hybrid model explicit.

### 5c) Org Chart Hierarchy: Great for Governance, Anti-Pattern for Execution

**Critical finding from research.** The TDD uses the org chart (CEO -> CTO -> Engineer) for BOTH governance and work execution. Research and production experience say these should be separated:

**Anthropic's "Building Effective Agents" (Dec 2024):** Explicitly warns against complex agent hierarchies. Recommends flat orchestrator-workers or simple pipelines.

**Microsoft's Magentic-One:** Uses orchestrator + specialists, NOT a hierarchy. The orchestrator dynamically plans and re-plans.

**Failure modes of deep hierarchies:**
1. **Telephone game:** Strategic intent degrades through layers. CEO's vision gets garbled by CTO, garbled again by Engineer.
2. **Latency multiplication:** Each delegation = 2+ extra LLM calls. A 3-layer hierarchy adds 6+ LLM calls per task.
3. **Accountability diffusion:** When something fails, which layer made the wrong call?
4. **Over-specialization:** Routing through rigid roles prevents flexible recombination.

**The fix: Separate governance from execution.**

| Concern | Use Hierarchy? | Use Flat Pool? |
|---|---|---|
| Budget attribution | Yes - costs roll up through org chart | |
| Approval flows | Yes - manager approves subordinate's work | |
| Quality review | Yes - peer/manager review | |
| **Work assignment** | | **Yes - match capabilities to task, not route through chain** |
| **Delegation** | | **Yes - orchestrator assigns directly to best-fit worker** |
| **Communication** | | **Yes - agents talk peer-to-peer when collaborating** |

The org chart defines WHO can do WHAT and WHO pays for WHAT. The orchestrator decides WHO actually does WHAT right now based on capability, availability, and cost.

### 5d) WASM Sandbox: Consider Docker as Primary

**What production agent systems actually use:**

| System | Sandboxing |
|---|---|
| Devin | Full VM (Firecracker microVM) |
| E2B.dev | Firecracker microVMs (specialized sandbox-as-a-service) |
| Claude Code | Process-level isolation |
| OpenClaw | Docker containers |
| Modal | Container-based isolation |

**The problem with WASM-first:** Most agent tools (git, npm, python, compilers) can't run in WASM. They spawn subprocesses, which bypass the WASM sandbox entirely. The TDD acknowledges this with a separate subprocess sandbox, meaning WASM only covers a subset of tool execution.

**Docker/containers provide stronger isolation with better compatibility:** A container gets filesystem isolation, network policy, resource limits, AND runs unmodified Python/TypeScript/whatever.

**Recommendation:** Docker isolation as **primary** sandboxing (covers 95% of cases). WASM as **optional high-security mode** for skills specifically compiled to WASM (marketplace skills). This matches what OpenClaw already does.

### 5e) Atomic Task Checkout: Keep It

The PostgreSQL-level atomic checkout is well-designed and battle-tested in Paperclip. The single-UPDATE-with-WHERE pattern prevents double-assignment without distributed locks. Keep this as-is.

**One addition:** Heartbeat timeout with automatic release. If an agent checks out a task and its heartbeat fails/times out, the checkout should auto-release after a configurable timeout, not require manual intervention.

### 5d) "Bring Your Own Agent" Adapter Pattern: Strong

This is one of the TDD's best decisions. The adapter pattern means ClawGear is not locked to any specific LLM runtime. As new agent frameworks emerge, they can be integrated without redesigning the core.

**Enhancement:** Add a `native` adapter that uses ClawGear's own LLM drivers directly (like OpenFang does), not just external CLI adapters. This gives you the best latency and control for agents that don't need a specific runtime.

---

## 6. STATUS & OBSERVABILITY: Wrong Abstraction Level

### Problem

The TDD tracks events and states (heartbeat status, token counts, tool calls). Operators need semantic progress and an attention-driven interface.

### What to Change

**a) Semantic Progress Events**

Replace raw tool_start/tool_result events with structured progress:
```json
{
  "phase": "research",
  "step": 2,
  "totalSteps": 5,
  "description": "Analyzing competitor pricing data",
  "confidence": 0.7,
  "blockers": []
}
```

Agents should emit these progress events as part of their heartbeat procedure.

**b) Enhanced Stuck Detection**

Beyond the SHA256 loop guard, add:
- Cosine similarity on recent actions (detect semantic loops, not just exact duplicates)
- Time-per-progress tracking (3x P95 duration without progress = flagged)
- Budget-proportional progress (80% budget spent, 20% progress = escalate)

**c) Attention Queue (Not 10-Tab Dashboard)**

The primary operator view should be a single prioritized queue:
```
1. [URGENT] Agent "engineer-1" failed quality gate on CG-142 (2 min ago)
2. [APPROVAL] CEO proposed Q2 strategy - needs board review (15 min ago)
3. [WARNING] Agent "researcher" at 85% monthly budget (1 hour ago)
4. [STUCK] Agent "social-media" has been on CG-201 for 4x expected time (2 hours ago)
5. [INFO] 3 issues completed today. $45.20 spent. All agents healthy.
```

This replaces 10 dashboard tabs with one actionable view.

---

## 7. SCOPE WARNING: THE BIGGEST RISK

The TDD describes a system with 11 Rust crates, 6+ TypeScript packages, 3 mobile apps, 20+ channel integrations, 7 autonomous Hands, a marketplace, migration from 3 platforms, a desktop app, a device node protocol, 3 communication protocols, and 16 security layers.

No agent startup has shipped anything close to this scope. The most successful agent companies focus:
- **Devin:** ONE thing (coding). Most well-funded agent company.
- **Cursor:** ONE thing (IDE-integrated coding). Fastest growing.
- **Claude Code:** ONE thing (CLI coding agent). Most capable.
- **Paperclip:** ONE thing (business orchestration). Focused scope.

**The risk is shipping nothing because you're building everything.**

**Recommended V1 scope (cut everything else for later):**
1. Core kernel (orchestration, budget, goal alignment)
2. ONE adapter (Claude Code)
3. Issue system with atomic checkout
4. Quality gates + self-reflection
5. Learning system (lessons_learned + experience retrieval)
6. Web dashboard with attention queue
7. ONE channel (Slack or WebChat)
8. Essential security (sandbox, RBAC, subprocess isolation, prompt injection defense)

That's it. No desktop app, no mobile, no 40 channels, no marketplace, no Hands, no P2P protocol, no Merkle chains, no migration engine. Prove the core loop works first: **assign work -> agent executes -> quality gate -> learn from outcome -> improve**.

---

## 8. REVISED DEVELOPMENT PHASES

Based on the critique, here is a reordered phasing that prioritizes correctly:

### Phase 0: Foundation (unchanged)
- Rust workspace, PostgreSQL schema, SQLite memory, Axum API, CLI skeleton

### Phase 1: Orchestration Core + Quality
- Company/agent/goal/project CRUD
- Org chart with reporting hierarchy
- Issue system with atomic checkout
- Heartbeat execution engine
- Budget enforcement with auto-pause
- **Quality gates (LLM-as-judge, self-reflection)**
- **Attention queue dashboard**
- Activity log (append-only -- NOT Merkle yet)

### Phase 2: Agent Runtime + Learning
- WASM sandbox with dual metering
- Adapter system (Claude Code, process, HTTP, native)
- Model routing with 4-tier selection
- Session persistence
- Skill injection
- **Post-run reflection and lesson storage**
- **Experience-indexed memory retrieval**
- **Shared knowledge in PostgreSQL + pgvector**
- **Peer review via hierarchy**

### Phase 3: Security (Essential Layers Only)
- RBAC capability gates
- Subprocess sandbox
- **Prompt injection defense (comprehensive)**
- SSRF protection
- Security headers
- Enhanced loop guard + stuck detection

### Phase 4: Communication + Channels
- WebSocket Gateway
- Channel adapters (Slack, Discord, Telegram, WebChat)
- Hybrid event model (heartbeat + event-driven for channels)
- DM/group policies

### Phase 5: Autonomous Operations
- Hands framework
- Researcher, Lead, Collector Hands
- Approval gates for Hands actions
- Hand dashboard

### Phase 6: Evolution
- **Skill evolution (agents create their own skills)**
- **Prompt optimization pipeline**
- **Competence tracking + graduated autonomy**
- **A/B testing for strategies**
- Workflow engine enhancements

### Phase 7: Desktop, Devices, Ecosystem
- Tauri desktop app
- Device node pairing
- Browser automation
- GearHub marketplace (NOW add Ed25519 signing)
- Migration engine

### Phase 8: Advanced Security + Scale
- Taint tracking
- Merkle hash-chain (if compliance requires it)
- Docker sandboxing
- P2P mutual auth (if multi-instance needed)
- Mobile companion apps

---

## 9. Summary: The 12 Changes That Matter Most

| # | Change | Why |
|---|---|---|
| 1 | **Add quality gate system** | Without it, humans are the only quality check. The system can never be autonomous. |
| 2 | **Add learning system (reflection + lessons + skill evolution)** | Without it, agents never improve. A static system in a dynamic world degrades. |
| 3 | **Separate governance topology from execution topology** | Org chart for budgets/approvals. Flat orchestrator + capability pool for work assignment. |
| 4 | **Cut scope to focused V1** | Ship one loop well (assign -> execute -> evaluate -> learn) before adding 40 channels and 7 Hands. |
| 5 | **Move shared knowledge to PostgreSQL + pgvector** | SQLite-per-agent prevents cross-agent learning, the core advantage of a team. |
| 6 | **Reconsider Rust-for-everything** | Use Rust for sandbox/crypto/desktop. Use faster-iteration language for orchestration logic. Or commit to Rust fully with an experienced team. |
| 7 | **Docker as primary sandbox, WASM as secondary** | Most tools can't run in WASM. Docker covers 95% of cases with zero friction. |
| 8 | **Design prompt injection defense in depth** | The #1 real attack vector. Currently one line in a 16-layer list. |
| 9 | **Defer Merkle chains, Ed25519, taint tracking** | Over-engineering for V1. Append-only logs + RBAC + sandbox are sufficient. |
| 10 | **Add semantic progress + attention queue** | Operators need actionable signals, not 10 dashboard tabs. |
| 11 | **Make heartbeat hybrid (scheduled + event-driven)** | Pure heartbeat adds unacceptable latency for real-time channel interactions. |
| 12 | **Add competence tracking + graduated autonomy** | Start supervised, earn autonomy through demonstrated competence. |

---

## 10. The North Star

The TDD should be guided by this question:

> **After running for 6 months, will ClawGear's agents be measurably better at their jobs than they were on day 1?**

If the answer is no -- if the agents run the same static prompts with the same static skills and produce the same quality outputs regardless of accumulated experience -- then ClawGear is an orchestration platform, not an operating system.

The learning and quality systems are what make the difference.
