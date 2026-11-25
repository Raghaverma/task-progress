# task-progress

A Claude Code plugin. It shows an estimated progress bar above the prompt and, when you turn it on, runs an orchestrator mode with small executors, asks you to approve the plan as cubes, routes work to feature-dev and code-simplifier agents, and has a terminal Cubes pane (agents, cubes, usage).

## Progress bar

- `TaskProgress` tool: the model reports task name, estimated total steps, steps done and a label; the band above the prompt renders the bar.
- `/progress`: shows the current progress as plain text; `/progress clear` clears it.

## Orchestrator mode and executors

Off by default (opt-in): `/tp-orchestrate on | off | status` (the plugin also ships a skill called `orchestrate`, so the engine refuses a bare `/orchestrate`). While it is off, only the progress bar runs: nothing is gated, timed or added to the system prompt.

- The main session plans and reviews; the `task-progress:executor` agent (Sonnet) executes one step each and ends with a fixed report (status, what changed, how verified, blockers). A short protocol is added to the system prompt; the full text is the `task-progress:orchestrate` skill. `TaskPlan` registers the plan and seeds the progress bar.
- **Time budgets.** Every Agent dispatch must start with `[budget: <N>m step: <k>]`, otherwise it is refused. Below 80% of the budget calls pass; from 80% the executor gets a one-time wrap-up notice; from 100% every tool call is refused (TaskProgress excepted) until it reports. The band shows a countdown per running executor.
- **Input check.** `TaskInputs` lists what the task needs from you (choices, paths, credentials) and tells Claude to ask it in one AskUserQuestion. It is advisory: no tool is refused until it is called.
- If another plugin bypasses prompt.compose, the rules are attached to user prompts instead.

## Approval cubes

For a multi-action task, Claude calls `TaskPlan` with `cubes` and stops. Each cube is one small, checkable piece of work; nothing runs until you approve it. Approve, edit and the other actions are done in the Cubes pane (`/tp-cubes`).

**A cube** has an `id` (c1, c2, ...), a `title`, one `action` sentence, a `flow` of 2-6 function-level steps, `after` (cubes that must finish first), `doneWhen` (a check that proves it is done), optional `files`, and `minutes` (at most 10). The cubes form a graph; the progress bar mirrors it, one step per cube.

**Description sections.** Every cube also carries `summary` (one or two plain sentences), `problem` (list of bullets), `steps` (ordered list of plain steps) and `code` (list of `{file, change}`: the file or `file › function` and what changes there). All four are required. The card's expandable body (Details) shows them as Summary, Problem, Steps and Code touched, then Done when, the flow and the review. Older cubes with only `details` show it as the Summary.

**Approach question gate.** `TaskPlan` with cubes is refused until Claude has called `AskUserQuestion` with a question whose header is "Approach" for the current prompt (it offers the ways to do the task and you pick one). The flag resets on every new prompt.

**Flow (details).** Each flow step is `{ file, fn, does, calls? }`: the repo-relative path (or `shell`, `browser`, `terminal`), the function or command, one short sentence, and an optional `file:fn` of the next function it calls (the arrow shown between steps). A step missing `file`, `fn` or `does` is refused.

**Atomic rules.** The plan is refused whole, naming the cube to fix, when a cube has no action, an action over 200 characters, fewer than 2 or more than 6 flow steps, no `doneWhen`, no minutes or more than 10, or when ids repeat, `after` names an unknown cube, there is a cycle, or there are more than 40 cubes.

**What you can do:**

- **Approve**: runs when its dependencies are done; otherwise it is queued and starts by itself once they finish. Cubes that become ready together go to Claude in one prompt.
- **Approve all** (hotkey `a` while the pane has focus), **Change…** (a request Claude answers with `CubeRevise`, possibly splitting the cube), **Reject**, **Retry** a failed cube, **Restore** a rejected one, **Mark done** (skips the review), **Delete**. Editing fields directly, adding and moving cubes exist as commands but have no controls yet.
- **Ask** a question about a cube: it is sent as `[cube question <id> "<title>"] <text>`; Claude answers with `CubeAnswer` and the answer shows in the cube's thread. Asking never changes the cube.

**Dispatch gate.** While orchestrator mode and the gate are on, an Agent dispatch tags the cubes it runs, `[budget: 6m step: 2 cubes: c3]`. A dispatch for an unapproved, unknown or still-waiting cube is denied. An untagged dispatch is not checked against the board, so an abandoned or stuck board never blocks other work.

**Main session only.** `TaskPlan`, `CubeRevise`, `CubeAnswer` and `CubeReview` refuse calls from sub-agents, so an executor cannot replace the plan or approve its own review.

**Combined review.** A cube whose executor finished goes to `reviewing` and no longer blocks its dependents. When every cube is built, one review runs: code-simplifier (only if code changed), then `task-progress:pr-reviewer` and `feature-dev:code-reviewer` in parallel (tag `review: <ids>`), then one `CubeReview` with `ids`. REQUEST_CHANGES reopens only cubes whose files carry P0/P1 findings. Dependents may start while a cube is in review, so a REQUEST_CHANGES fix to an earlier cube can affect later cubes that are already built; the orchestrator should re-check those. Escape hatch: `cube.markDone`.

`/tp-cubes on | off | status | clear` turns the gate on or off for new boards, shows the counts, or drops the board (with its plan and the progress bar it seeded) when it is abandoned or stuck.


### Cubes pane

`/tp-cubes` opens it; it also opens by itself when a plan is made and on resume with unfinished cubes. The surface places it (docked beside the transcript when there is room). It works in the terminal and in the editor extensions:

- **Header**: the task, a progress bar (a native one in VS Code and the desktop app) and the counts.
- **Needs you**: cubes waiting for approval, failed cubes, and rejected cubes that hold others back, each with its actions on the row.
- **In progress** and **Up next**: one line per cube with what its agent is doing, its countdown, or what it waits for. Select a row for its details (summary, problem, steps, code, done when, review findings, your questions and Claude's answers) and its actions.
- **Done**: folded to a count; Show lists it.
- **Agents** not tied to a cube, and **Usage** (5-hour and 7-day limits).

VS Code draws no band above the prompt, so there the task's progress rides on the spinner line (`Working… · Fix login · 3/7 · ~2m left`).

## Agent animation

- The band shows one row per running agent: its cube, time left and last tool, with a done line when they finish.
- The Agents pane shows big animated art. It opens on its own when agents start (in terminals at least 144 columns wide) and closes 3 s after they finish.
- `/tp-agents` opens or closes the pane.

## Context map when a plan finishes

When the last cube of a plan finishes, the plugin runs `/context` and saves the output in `~/.claude/task-progress-context/` (20 numbered files, the oldest overwritten first). It never clears the conversation: a toast suggests `/clear` and you decide. This happens once per plan.

## Install

    claude plugin marketplace add <path or repo>
    claude plugin install task-progress@local-mods

`feature-dev` and `code-simplifier` come along as dependencies from `claude-plugins-official` (add that marketplace first). Session start warns with the install commands if they are missing. `pr-reviewer` is bundled.

Plugin manifest: `.claude-plugin/plugin.json`. Hook module: `hooks/register.tsx`.
