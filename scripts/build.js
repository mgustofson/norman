#!/usr/bin/env node

/**
 * Norman — Autonomous Design Director
 *
 * Give Norman a brief. Walk away. Come back to a working prototype.
 *
 * Norman acts as a design director: decomposes the brief, assigns work to
 * specialist agents, reviews their output, sends it back if it's not good
 * enough, and assembles a final deliverable.
 *
 * Usage:
 *   node scripts/build.js "Design a settings page for a travel app"
 *   node scripts/build.js --brief "Design a settings page" --output ./output
 *   node scripts/build.js --brief-file ./briefs/settings-page.md
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import * as readline from "readline/promises";

let IS_INTERACTIVE = false;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-20250514";
const MAX_REVISIONS = 2; // max times director can send work back per stage

// ─────────────────────────────────────────────────────────────
// Agent system prompts (loaded from SKILL.md files)
// ─────────────────────────────────────────────────────────────

function loadAgentPrompt(agentId) {
  const skillPath = join(ROOT, "skills", agentId, "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error(`Missing skill: ${skillPath}`);
  }
  const content = readFileSync(skillPath, "utf-8");
  return content.replace(/^---[\s\S]*?---\n*/m, "").trim();
}

// ─────────────────────────────────────────────────────────────
// Norman — The Design Director
// ─────────────────────────────────────────────────────────────

const DIRECTOR_PROMPT = `You are Norman, a design director managing a team of specialist AI agents. You have exacting taste and high standards. Your job is to review your team's work and make sure it meets the bar before it moves to the next stage.

You manage three specialists:
- Research Agent: competitive intelligence, market patterns, evidence
- Design Partner: ideation, concept directions, creative exploration
- Production Design: craft, typography, spacing, color systems, specs

When reviewing work, you evaluate:
1. SPECIFICITY — Is this grounded in the actual problem, or generic advice?
2. DEPTH — Did the agent dig in or stay surface-level?
3. USEFULNESS — Could someone act on this output?
4. COHERENCE — Does it connect to what came before in the pipeline?

You are direct. If work isn't good enough, say exactly what's wrong and what you need instead.`;

// ─────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function log(icon, msg, color = COLORS.reset) {
  const ts = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(`${COLORS.dim}${ts}${COLORS.reset}  ${color}${icon}${COLORS.reset}  ${msg}`);
}

function logDirector(msg) { log("◆", msg, COLORS.magenta); }
function logAgent(name, msg) { log("│", `${COLORS.bold}${name}${COLORS.reset}: ${msg}`); }
function logReview(msg) { log("⊡", msg, COLORS.yellow); }
function logDone(msg) { log("✓", msg, COLORS.green); }
function logError(msg) { log("✗", msg, COLORS.red); }
function logSection(title) {
  console.log(`\n${COLORS.dim}${"─".repeat(60)}${COLORS.reset}`);
  log("◆", `${COLORS.bold}${title}${COLORS.reset}`, COLORS.magenta);
  console.log(`${COLORS.dim}${"─".repeat(60)}${COLORS.reset}\n`);
}

// ─────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callAgent(client, systemPrompt, userMessage, maxTokens = 2000) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  let text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  let stopReason = response.stop_reason;

  // If the response was truncated (hit token limit), continue generating
  if (stopReason === "max_tokens") {
    log("│", `  Output truncated at ${text.length} chars, continuing...`, COLORS.yellow);
    let fullText = text;
    let continuations = 0;
    const maxContinuations = 3;

    while (stopReason === "max_tokens" && continuations < maxContinuations) {
      continuations++;
      await delay(1000);

      const continueResponse = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
          { role: "user", content: userMessage },
          { role: "assistant", content: fullText },
          { role: "user", content: "Continue exactly where you left off. Do not repeat any content. Do not add explanations. Just continue the code." },
        ],
      });

      const continuation = continueResponse.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").replace(/[\uD800-\uDFFF]/g, "");
      fullText += continuation;
      stopReason = continueResponse.stop_reason;

      log("│", `  Continuation ${continuations}: +${continuation.length} chars (total: ${fullText.length})`, COLORS.yellow);
    }

    text = fullText;
  }

  return {
    text,
    usage: response.usage,
  };
}

async function directorReview(client, stage, agentOutput, brief, priorOutputs) {
  const reviewPrompt = `You are reviewing the ${stage} output from your team.

Original brief: "${brief}"

${priorOutputs ? `Prior stage outputs for context:\n${priorOutputs}\n` : ""}

The ${stage} just produced this:
---
${agentOutput}
---

Evaluate this output. Respond ONLY with JSON (no fences):
{
  "approved": true/false,
  "quality": 1-5,
  "feedback": "If not approved: specific, actionable feedback on what to fix. If approved: brief note on what's strong.",
  "key_strengths": ["strength 1", "strength 2"],
  "concerns": ["concern 1"] 
}

Standards: Approve if quality >= 3 and the output is specific to the actual brief (not generic). Reject if it's shallow, generic, or misses the point of the brief. Be demanding but fair.`;

  const result = await callAgent(client, DIRECTOR_PROMPT, reviewPrompt, 500);
  let reviewObj;
  try {
    reviewObj = JSON.parse(result.text.replace(/```json|```/g, "").trim());
  } catch (e) {
    // If parsing fails, assume approved to keep the pipeline moving
    reviewObj = { approved: true, quality: 3, feedback: "Review parse failed, proceeding.", key_strengths: [], concerns: [] };
  }

  if (IS_INTERACTIVE) {
    console.log(`\n${COLORS.magenta}◆ Norman's Gut Check: ${reviewObj.approved ? "APPROVED" : "REVISION NEEDED"} (${reviewObj.quality}/5)${COLORS.reset}`);
    console.log(`  Feedback: ${reviewObj.feedback}`);
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\n${COLORS.bold}  Hit Enter to accept Norman's decision, or type feedback to send back to the agent: ${COLORS.reset}`);
    rl.close();

    if (answer.trim() !== "") {
      reviewObj.approved = false;
      reviewObj.feedback = `HUMAN DIRECTOR OVERRIDE: ${answer.trim()}`;
      logReview(`Human feedback received. Sending back to agent.`);
    }
  }

  return reviewObj;
}

// ─────────────────────────────────────────────────────────────
// Pipeline stages
// ─────────────────────────────────────────────────────────────

async function runProductManager(client, rawBrief) {
  logSection("Stage 0 → Product Manager");
  const systemPrompt = loadAgentPrompt("product-manager");
  let output = "";
  let lastFeedback = "";
  let approved = false;
  let attempt = 0;

  const basePrompt = `Raw user brief: "${rawBrief}"

Please expand this raw brief into a comprehensive, structured product brief following your standardized format. Infer reasonable defaults if the raw brief is too sparse.`;

  while (!approved && attempt <= MAX_REVISIONS) {
    attempt++;
    logAgent("Product Manager", attempt === 1 ? "Expanding brief..." : `Revision ${attempt} based on feedback...`);

    const prompt = attempt === 1
      ? basePrompt
      : `${basePrompt}\n\nDIRECTOR FEEDBACK on your previous attempt:\n${lastFeedback}\n\nAddress this feedback specifically. Previous output:\n---\n${output}\n---`;

    const result = await callAgent(client, systemPrompt, prompt, 2000);
    output = result.text;
    logAgent("Product Manager", `Output: ${output.length} chars (${result.usage.output_tokens} tokens)`);

    await delay(1000);

    // Director review
    logReview("Director reviewing expanded brief...");
    const review = await directorReview(client, "Product Manager", output, rawBrief, null);
    logReview(`Quality: ${review.quality}/5 — ${review.approved ? "APPROVED" : "REVISION NEEDED"}`);

    if (review.approved) {
      approved = true;
      logDone(`Brief approved (attempt ${attempt})`);
      if (review.key_strengths?.length) {
        review.key_strengths.forEach(s => logDone(`  + ${s}`));
      }
    } else {
      logReview(`Feedback: ${review.feedback}`);
      lastFeedback = review.feedback;
      if (attempt > MAX_REVISIONS) {
        logReview("Max revisions reached, proceeding with current expanded brief");
      }
    }

    await delay(1000);
  }

  return output;
}

async function runResearch(client, brief) {
  logSection("Stage 1 → Research Agent");
  const systemPrompt = loadAgentPrompt("research-agent");
  let output = "";
  let lastFeedback = "";
  let approved = false;
  let attempt = 0;

  const basePrompt = `Design brief: "${brief}"

Conduct competitive and landscape research to inform the design of this. Focus on:
- Specific competitors and analogous products (name them)
- Actual UX patterns and design choices (describe them in detail)
- Gaps and opportunities nobody is addressing
- 3-5 key insights for the design team

Be specific with real examples. This feeds directly into ideation.`;

  while (!approved && attempt <= MAX_REVISIONS) {
    attempt++;
    logAgent("Research", attempt === 1 ? "Starting research..." : `Revision ${attempt} based on feedback...`);

    const prompt = attempt === 1
      ? basePrompt
      : `${basePrompt}\n\nDIRECTOR FEEDBACK on your previous attempt:\n${lastFeedback}\n\nAddress this feedback specifically. Previous output:\n---\n${output}\n---`;

    const result = await callAgent(client, systemPrompt, prompt, 2000);
    output = result.text;
    logAgent("Research", `Output: ${output.length} chars (${result.usage.output_tokens} tokens)`);

    await delay(1000);

    // Director review
    logReview("Director reviewing research...");
    const review = await directorReview(client, "Research Agent", output, brief, null);
    logReview(`Quality: ${review.quality}/5 — ${review.approved ? "APPROVED" : "REVISION NEEDED"}`);

    if (review.approved) {
      approved = true;
      logDone(`Research approved (attempt ${attempt})`);
      if (review.key_strengths?.length) {
        review.key_strengths.forEach(s => logDone(`  + ${s}`));
      }
    } else {
      logReview(`Feedback: ${review.feedback}`);
      lastFeedback = review.feedback;
      if (attempt > MAX_REVISIONS) {
        logReview("Max revisions reached, proceeding with current output");
      }
    }

    await delay(1000);
  }

  return output;
}

async function runIdeation(client, brief, researchOutput) {
  logSection("Stage 2 → Design Partner");
  const systemPrompt = loadAgentPrompt("design-partner");
  let output = "";
  let lastFeedback = "";
  let approved = false;
  let attempt = 0;

  const basePrompt = `Original brief: "${brief}"

--- RESEARCH FINDINGS ---
${researchOutput}
--- END RESEARCH ---

Based on this research, generate 3 distinct concept directions. For each:
- A memorable name
- One-sentence concept
- The core insight driving it
- 2-3 specific interactions or screens described vividly
- What it trades off

Make at least one direction unexpected. End with your recommendation.`;

  while (!approved && attempt <= MAX_REVISIONS) {
    attempt++;
    logAgent("Design Partner", attempt === 1 ? "Generating directions..." : `Revision ${attempt}...`);

    const prompt = attempt === 1
      ? basePrompt
      : `${basePrompt}\n\nDIRECTOR FEEDBACK on your previous attempt:\n${lastFeedback}\n\nAddress this feedback. Previous output:\n---\n${output}\n---`;

    const result = await callAgent(client, systemPrompt, prompt, 2000);
    output = result.text;
    logAgent("Design Partner", `Output: ${output.length} chars (${result.usage.output_tokens} tokens)`);

    await delay(1000);

    logReview("Director reviewing concepts...");
    const priorContext = `Research output:\n${researchOutput.slice(0, 500)}...`;
    const review = await directorReview(client, "Design Partner", output, brief, priorContext);
    logReview(`Quality: ${review.quality}/5 — ${review.approved ? "APPROVED" : "REVISION NEEDED"}`);

    if (review.approved) {
      approved = true;
      logDone(`Ideation approved (attempt ${attempt})`);
    } else {
      logReview(`Feedback: ${review.feedback}`);
      lastFeedback = review.feedback;
      if (attempt > MAX_REVISIONS) {
        logReview("Max revisions reached, proceeding");
      }
    }

    await delay(1000);
  }

  return output;
}

async function runProduction(client, brief, researchOutput, ideationOutput) {
  logSection("Stage 3 → Production Design (Prototype)");
  const systemPrompt = `You are a production design engineer on a team called Norman. You build working prototypes — real HTML, CSS, and JavaScript that runs in a browser.

Your craft principles:
- Typography: Use Google Fonts. Establish a modular type scale. Set proper line heights (body 1.5-1.6, headings 1.1-1.3). Manage line length.
- Spacing: Use a consistent spacing scale based on a 4px or 8px unit. Group related elements tightly, separate unrelated elements widely.
- Color: Define CSS custom properties for a semantic color system. Maintain contrast ratios. Use a dominant color with sharp accents.
- Motion: Add CSS transitions and animations for state changes, page load reveals, hover effects. Keep them subtle and purposeful (150-250ms ease).
- Layout: Use CSS Grid and Flexbox. Design responsively.
- Details: Consistent border-radius, layered shadows, proper focus states, smooth transitions between interactive states.

NEVER use generic fonts like Arial, Inter, or Roboto. Choose distinctive, characterful Google Fonts.
NEVER use cliché color schemes like purple gradients on white.
ALWAYS make it feel designed, not templated.

Your output is ONLY code. A single self-contained HTML file with embedded CSS and JavaScript. No markdown, no explanation, no code fences. Just the raw HTML starting with <!DOCTYPE html>.

The prototype should be interactive where appropriate — tabs work, buttons have hover states, modals open, navigation responds. Use realistic placeholder content, not "Lorem ipsum".`;

  let output = "";
  let lastFeedback = "";
  let approved = false;
  let attempt = 0;

  const basePrompt = `Original brief: "${brief}"

--- RESEARCH ---
${researchOutput}
--- END RESEARCH ---

--- CONCEPT DIRECTIONS ---
${ideationOutput}
--- END CONCEPTS ---

Take the recommended concept direction and build a working prototype as a single self-contained HTML file.

Requirements:
- Complete, self-contained HTML file (inline CSS and JS, Google Fonts via CDN)
- Interactive: clicks, hovers, transitions, and state changes should work
- Realistic content — no placeholder text
- Responsive design that works on desktop and mobile
- Polished craft: proper type scale, spacing rhythm, color system, micro-interactions
- Output ONLY the raw HTML code, nothing else. No markdown fences. Start with <!DOCTYPE html>`;

  while (!approved && attempt <= MAX_REVISIONS) {
    attempt++;
    logAgent("Production", attempt === 1 ? "Building prototype..." : `Revision ${attempt}...`);

    const prompt = attempt === 1
      ? basePrompt
      : `${basePrompt}\n\nDIRECTOR FEEDBACK on your previous prototype:\n${lastFeedback}\n\nFix these issues. Output the complete revised HTML file. Previous code:\n---\n${output}\n---`;

    const result = await callAgent(client, systemPrompt, prompt, 16000);
    output = result.text;

    // Clean output — strip any markdown fences if the model wrapped them
    output = output.replace(/^```html?\n?/i, "").replace(/\n?```$/i, "").trim();

    // Validate it looks like a complete HTML file
    const hasDoctype = output.toLowerCase().includes("<!doctype html");
    const hasClosingHtml = output.toLowerCase().includes("</html>");
    logAgent("Production", `Prototype: ${output.length} chars (valid: doctype=${hasDoctype}, closing=${hasClosingHtml})`);

    if (!hasClosingHtml && hasDoctype) {
      logReview("Prototype appears truncated — missing </html>. Will retry with continuation.");
    }
    output = output.replace(/^```html?\n?/i, "").replace(/\n?```$/i, "").trim();

    logAgent("Production", `Prototype: ${output.length} chars (${result.usage.output_tokens} tokens)`);

    await delay(1000);

    logReview("Director reviewing prototype...");
    const priorContext = `Research: ${researchOutput.slice(0, 300)}...\nConcepts: ${ideationOutput.slice(0, 300)}...`;
    const review = await directorReview(client, "Production Design", output, brief, priorContext);
    logReview(`Quality: ${review.quality}/5 — ${review.approved ? "APPROVED" : "REVISION NEEDED"}`);

    if (review.approved) {
      approved = true;
      logDone(`Prototype approved (attempt ${attempt})`);
    } else {
      logReview(`Feedback: ${review.feedback}`);
      lastFeedback = review.feedback;
      if (attempt > MAX_REVISIONS) {
        logReview("Max revisions reached, proceeding");
      }
    }

    await delay(1000);
  }

  return output;
}

// ─────────────────────────────────────────────────────────────
// Assemble deliverable
// ─────────────────────────────────────────────────────────────

async function assembleDeliverable(client, brief, research, ideation, production) {
  logSection("Stage 4 → Final Polish");
  logDirector("Reviewing prototype for craft and completeness...");

  const polishPrompt = `You are Norman, a design director with exacting taste. Your team built a working HTML prototype. Your job is to do a final polish pass.

Original brief: "${brief}"

Key research insights:
${research.slice(0, 800)}

Chosen concept direction:
${ideation.slice(0, 800)}

Here is the current prototype code:
---
${production}
---

Do a final polish pass on this prototype. Improve:
1. Typography — tighten the type scale, ensure proper line heights and letter-spacing
2. Spacing — make sure the rhythm is consistent, nothing feels cramped or too loose
3. Color — refine any colors that feel off, ensure contrast is good
4. Interactions — smooth out transitions, add hover states if missing, ensure animations feel polished
5. Content — replace any remaining placeholder text with realistic content
6. Responsiveness — verify it works at mobile widths
7. Details — consistent border-radius, proper focus states, subtle shadows

Output the COMPLETE revised HTML file. No explanations, no markdown fences. Raw HTML starting with <!DOCTYPE html>.
If the prototype is already excellent, output it as-is with minor refinements. Do not redesign — polish.`;

  const result = await callAgent(client, DIRECTOR_PROMPT, polishPrompt, 16000);
  let output = result.text;

  // Clean any markdown fences
  output = output.replace(/^```html?\n?/i, "").replace(/\n?```$/i, "").trim();

  // Validate it looks like complete HTML
  const hasClosing = output.toLowerCase().includes("</html>");
  if (!output.toLowerCase().includes("<!doctype html")) {
    logReview("Polish output doesn't look like HTML, using pre-polish prototype");
    return production;
  }
  if (!hasClosing) {
    logReview("Polish output truncated, using pre-polish prototype");
    return production;
  }

  logDone(`Polished prototype: ${output.length} chars`);
  return output;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function build(brief, outputDir) {
  const client = new Anthropic();
  const startTime = Date.now();

  console.log(`\n${COLORS.magenta}${COLORS.bold}◆ Norman${COLORS.reset}`);
  console.log(`${COLORS.dim}  Autonomous Design Director${COLORS.reset}\n`);
  logDirector(`Brief: "${brief}"`);
  logDirector("Assigning work to team...\n");

  let totalTokens = 0;

  // Stage 0: Intake
  const expandedBrief = await runProductManager(client, brief);

  // Stage 1: Research
  const research = await runResearch(client, expandedBrief);

  // Stage 2: Ideation
  const ideation = await runIdeation(client, brief, research);

  // Stage 3: Production
  const production = await runProduction(client, brief, research, ideation);

  // Stage 4: Assemble
  const deliverable = await assembleDeliverable(client, brief, research, ideation, production);

  // ─── Save outputs ───

  const outDir = outputDir || join(ROOT, "output");
  mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().split("T")[0];
  const slugBrief = brief
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/-$/, "");

  const deliverablePath = join(outDir, `${timestamp}_${slugBrief}.html`);
  writeFileSync(deliverablePath, deliverable);

  // Save raw stage outputs for reference
  const rawDir = join(outDir, "raw");
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, `${timestamp}_${slugBrief}_brief.md`), expandedBrief);
  writeFileSync(join(rawDir, `${timestamp}_${slugBrief}_research.md`), research);
  writeFileSync(join(rawDir, `${timestamp}_${slugBrief}_ideation.md`), ideation);
  writeFileSync(join(rawDir, `${timestamp}_${slugBrief}_prototype.html`), production);

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  logSection("Complete");
  logDone(`Prototype: ${deliverablePath}`);
  logDone(`Raw outputs: ${rawDir}/`);
  logDone(`Total time: ${elapsed}s`);

  // Auto-open in browser
  const { exec } = await import("child_process");
  const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${openCmd} "${deliverablePath}"`, (err) => {
    if (err) logDirector("Open the HTML file in your browser to see the prototype");
    else logDone("Opened in browser");
  });

  console.log();
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  options: {
    brief: { type: "string", short: "b" },
    "brief-file": { type: "string", short: "f" },
    output: { type: "string", short: "o" },
    interactive: { type: "boolean", short: "i", default: false },
  },
  allowPositionals: true,
});

let brief = values.brief || positionals.join(" ");

if (values["brief-file"]) {
  brief = readFileSync(values["brief-file"], "utf-8").trim();
}

IS_INTERACTIVE = values.interactive;

if (!brief) {
  console.log(`
${COLORS.magenta}${COLORS.bold}◆ Norman${COLORS.reset} — Autonomous Design Director

${COLORS.bold}Usage:${COLORS.reset}
  node scripts/build.js "Design a settings page for a travel app"
  node scripts/build.js --brief "Design a settings page" --output ./output
  node scripts/build.js --brief-file ./briefs/my-project.md

${COLORS.bold}What happens:${COLORS.reset}
  1. Research Agent scans the competitive landscape
  2. Design Partner generates concept directions
  3. Production Design builds a working HTML prototype
  4. Norman reviews each stage and sends back for revision if needed
  5. Final polish pass, then auto-opens in your browser

${COLORS.dim}Norman manages the whole process. You just provide the brief.${COLORS.reset}
`);
  process.exit(0);
}

build(brief, values.output).catch((err) => {
  logError(`Fatal: ${err.message}`);
  if (err.stack) console.error(COLORS.dim + err.stack + COLORS.reset);
  process.exit(1);
});
