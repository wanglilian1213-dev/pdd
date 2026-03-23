# Draft Writing Rules Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the user’s new writing rules to the first full-draft generation step without changing later word-calibration or citation-fix steps.

**Architecture:** Keep the change tightly scoped to `generateDraft()` in `writingService.ts`. Add one focused test that inspects the first-draft prompt content, then minimally expand the system prompt so the new writing rules are sent only during initial draft generation.

**Tech Stack:** Node.js, TypeScript, `tsx --test`, existing OpenAI Responses pipeline

---

### Task 1: Add design and planning docs

**Files:**
- Create: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/draft-writing-rules/docs/plans/2026-03-23-draft-writing-rules-design.md`
- Create: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/draft-writing-rules/docs/plans/2026-03-23-draft-writing-rules.md`

**Step 1: Write the two docs**

Document the approved scope:

- only first draft generation changes
- no hard programmatic sentence policing
- no changes to word calibration
- no changes to citation verification

**Step 2: Verify docs exist**

Run: `ls docs/plans | grep draft-writing-rules`
Expected: both files listed

### Task 2: Add a failing prompt test for first draft generation

**Files:**
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/draft-writing-rules/server/src/services/writingService.test.ts`

**Step 1: Write the failing test**

Add a focused test that proves the first-draft system prompt includes the new requirements, such as:

- write the entire article at once
- write all chapters
- paragraphs only, no bullet points
- critical argumentative discussion
- third person with a clear stand
- detailed evidence
- avoid straight quotation marks
- avoid em dash
- references should include proper links

**Step 2: Run the test and confirm failure**

Run: `cd server && npm test -- src/services/writingService.test.ts`
Expected: FAIL because current prompt does not include the new wording

### Task 3: Implement the first-draft prompt update

**Files:**
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/draft-writing-rules/server/src/services/writingService.ts`

**Step 1: Write minimal implementation**

Update only the `generateDraft()` system prompt so it now includes:

- whole article in one pass
- all outline chapters must be written
- paragraphs only
- strong critical argumentative discussion
- thesis-aligned argument
- concrete evidence
- clear position in third person
- avoid shallow talk
- avoid the banned punctuation/pattern instructions from the user
- reference entries should carry proper links

Do not modify:

- `calibrateWordCount()`
- `verifyCitations()`

**Step 2: Re-run the focused test**

Run: `cd server && npm test -- src/services/writingService.test.ts`
Expected: PASS

### Task 4: Sync project docs with the new real behavior

**Files:**
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/draft-writing-rules/agent.md`
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/draft-writing-rules/PLAN.md`
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/draft-writing-rules/DESIGN.md`

**Step 1: Update docs**

Document that first-draft generation now includes the stronger writing-rule prompt, while later calibration and citation-fix steps remain unchanged.

**Step 2: Review doc diff**

Run: `git diff -- agent.md PLAN.md DESIGN.md docs/plans/2026-03-23-draft-writing-rules-design.md docs/plans/2026-03-23-draft-writing-rules.md`
Expected: docs match the real scope

### Task 5: Run full backend verification

**Files:**
- No code changes required

**Step 1: Run tests**

Run: `cd server && npm test`
Expected: PASS

**Step 2: Run lint**

Run: `cd server && npm run lint`
Expected: PASS

**Step 3: Run build**

Run: `cd server && npm run build`
Expected: PASS

### Task 6: Publish all online services

**Files:**
- No source file changes required

**Step 1: Commit**

Run:
```bash
git add agent.md PLAN.md DESIGN.md docs/plans/2026-03-23-draft-writing-rules-design.md docs/plans/2026-03-23-draft-writing-rules.md server/src/services/writingService.ts server/src/services/writingService.test.ts
git commit -m "feat: tighten first draft writing prompt"
```

**Step 2: Push**

Run: `git push origin HEAD:main`
Expected: push succeeds

**Step 3: Verify all online services updated**

Check:

- GitHub main updated
- Railway `app` updated
- Railway `cleanup` updated
- Railway `拼代代前端` updated

### Task 7: Run one real online writing flow check

**Files:**
- No permanent source change required

**Step 1: Create a real test task**

Use a temporary account and go through:

- create task
- wait for outline
- confirm outline
- observe writing pipeline start normally

**Step 2: Confirm no prompt change breakage**

The goal here is not to score essay quality manually, but to confirm:

- first draft generation still starts
- task can continue through the main writing pipeline
- no prompt-format error is introduced

