# Document Delivery Format Implementation Plan

> **Update on 2026-03-30:** This older implementation note now needs to be read together with `docs/plans/2026-03-30-cover-reference-pdf.md`. The current real behavior already includes: automatic course-code extraction, a dedicated cover page, body starting on page 2, `Reference` on a new page, task-title-based Word filenames, and PDF report re-layout to avoid long-text overlap.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a properly formatted Word paper and a professional PDF citation validation report instead of the current plain-text style outputs.

**Architecture:** Keep AI responsible for content generation, but move final presentation into deterministic export helpers. The writing pipeline will hand final text to a new Word formatter and hand citation-report content to a structured-report parser plus fixed PDF renderer so the exported files are stable and professional.

**Tech Stack:** Node.js, TypeScript, `docx`, `pdfkit`, existing Express + Supabase storage pipeline

---

### Task 1: Add delivery-format design and project-rule sync

**Files:**
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/agent.md`
- Create: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/docs/plans/2026-03-23-document-delivery-format-design.md`
- Create: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/docs/plans/2026-03-23-document-delivery-format.md`

**Step 1: Write the files**

Write the agent rule update plus the design and implementation documents.

**Step 2: Verify they exist**

Run: `ls docs/plans | grep 2026-03-23-document-delivery-format`
Expected: both new plan files listed

**Step 3: Commit later with code changes**

Do not commit this task alone.

### Task 2: Add failing tests for formal Word formatting

**Files:**
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/server/src/services/writingService.test.ts`
- Create: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/server/src/services/documentFormattingService.test.ts`

**Step 1: Write the failing tests**

Add tests that require:

- Word output to use Times New Roman 12
- Title paragraph to be centered and bold
- Body paragraphs to use 1.5 line spacing
- Reference paragraphs to use hanging indent

**Step 2: Run test to verify it fails**

Run: `cd server && npm test -- src/services/documentFormattingService.test.ts src/services/writingService.test.ts`
Expected: FAIL because helper does not exist or output does not match expected formatting rules

**Step 3: Commit later with implementation**

Do not commit this task alone.

### Task 3: Implement Word formatting helper

**Files:**
- Create: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/server/src/services/documentFormattingService.ts`
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/server/src/services/writingService.ts`

**Step 1: Write minimal implementation**

Create a helper that:

- detects title
- builds Word paragraphs with fixed font/size
- applies centered bold style to title
- applies 1.5 line spacing to body
- detects reference section and applies hanging indent

**Step 2: Run targeted tests**

Run: `cd server && npm test -- src/services/documentFormattingService.test.ts src/services/writingService.test.ts`
Expected: PASS

### Task 4: Add failing tests for PDF citation report

**Files:**
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/server/src/services/writingService.test.ts`
- Create: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/server/src/services/citationReportTemplateService.test.ts`

**Step 1: Write the failing tests**

Require that:

- report file type becomes PDF, not txt
- report prompt asks for structured report data
- parsed report data and rendered PDF include top header, summary section, tables, and recommendation section

**Step 2: Run test to verify it fails**

Run: `cd server && npm test -- src/services/citationReportTemplateService.test.ts src/services/writingService.test.ts`
Expected: FAIL because report is still txt/plain text

### Task 5: Implement structured report parsing and PDF rendering

**Files:**
- Create: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/server/src/services/citationReportTemplateService.ts`
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/server/src/services/writingService.ts`
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/server/package.json`

**Step 1: Write minimal implementation**

Add:

- structured report parser with safe fallbacks
- PDF rendering path using `pdfkit`
- delivery path storing `citation-report.pdf`

**Step 2: Run targeted tests**

Run: `cd server && npm test -- src/services/citationReportTemplateService.test.ts src/services/writingService.test.ts`
Expected: PASS

### Task 6: Render and visually verify sample outputs

**Files:**
- Use generated temp files only

**Step 1: Generate a sample Word and PDF locally**

Run a focused script or test helper to export:

- one sample paper Word file
- one sample citation report PDF

**Step 2: Inspect rendered output**

For Word:
- convert/render and inspect title, line spacing, references

For PDF:
- render pages and inspect card layout, table readability, and no clipping

**Step 3: Fix any layout issue and repeat until clean**

### Task 7: Run full backend verification

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

### Task 8: Sync project docs with reality

**Files:**
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/PLAN.md`
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/DESIGN.md`
- Modify: `/Users/jeffo/.config/superpowers/worktrees/拼代代/codex/document-formatting/agent.md`

**Step 1: Update docs**

Document that:

- final paper is formatted Word
- citation validation report is PDF
- every change must sync docs and all online services

**Step 2: Review diff**

Run: `git diff -- agent.md PLAN.md DESIGN.md docs/plans/2026-03-23-document-delivery-format-design.md docs/plans/2026-03-23-document-delivery-format.md`
Expected: docs match implementation

### Task 9: Publish all online services

**Files:**
- No source file changes required

**Step 1: Commit**

Run:
```bash
git add agent.md PLAN.md DESIGN.md docs/plans/2026-03-23-document-delivery-format-design.md docs/plans/2026-03-23-document-delivery-format.md server/package.json server/src/services/documentFormattingService.ts server/src/services/documentFormattingService.test.ts server/src/services/citationReportTemplateService.ts server/src/services/citationReportTemplateService.test.ts server/src/services/writingService.ts server/src/services/writingService.test.ts
git commit -m "feat: format final paper and citation report deliverables"
```

**Step 2: Push**

Run: `git push origin main`
Expected: push succeeds

**Step 3: Verify all online services updated**

Check:

- GitHub Actions deploy app
- GitHub Actions deploy cleanup
- GitHub Actions deploy frontend

Expected: all succeed, even if frontend has no bundle changes

### Task 10: Run one real online task end-to-end

**Files:**
- No permanent source change required

**Step 1: Create a real task online**

Use a temporary account or test account.

**Step 2: Wait for final delivery**

Confirm downloadable files are:

- formatted Word paper
- PDF citation report

**Step 3: Inspect the actual downloaded files**

Verify:

- paper title centered and bold
- body uses formal paragraph formatting
- references have hanging indent
- report is PDF and visually structured

**Step 4: Commit nothing extra unless fixes are needed**
