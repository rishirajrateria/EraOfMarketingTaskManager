# EraOfMarketing Task Manager — Claude Code configuration

## Ruflo (claude-flow) orchestration
- The `claude-flow` MCP server is registered in `.mcp.json` and starts with the session (`npx -y ruflo@latest mcp start`).
- Ruflo agent definitions live in `.claude/agents/` and are available as `subagent_type` values: planner, coder, reviewer, researcher, tester, backend-dev, system-architect, code-analyzer, production-validator, tdd-london-swarm, specification, architecture, refinement, hierarchical-coordinator, database-specialist, typescript-specialist, security-auditor.
- Use `mcp__claude-flow__swarm_init` (hierarchical topology) and `mcp__claude-flow__agent_spawn` to coordinate; use `mcp__claude-flow__memory_*` to persist decisions across sessions. Do not poll swarm status repeatedly; wait for results.
- Prefer cheaper models for narrow, well-specified subtasks (tests, lint fixes, boilerplate). Keep the orchestrator turn short and delegate.

## Authoritative documents
- `docs/SPEC.md` — the full product build prompt (what to build). Ruflo's coder/architect agents read this before implementing.
- `docs/adr/*.md` — architecture decisions, once created. ADRs win on architecture; SPEC wins on scope.

## Project rules
- Next.js App Router + TypeScript + Tailwind, Prisma + PostgreSQL, NextAuth Google provider (see SPEC §1).
- Never commit `.env` files or secrets.
- Keep files under 500 lines; put source in `src/`, tests in `tests/` or co-located `*.test.ts`, docs in `docs/`.
- Follow the build order in SPEC §15; each phase must build and pass tests before moving on.
