#!/usr/bin/env node

/**
 * Norman — Build Review & Feedback
 *
 * After a build, use this to:
 *   1. Ask WHY Norman made certain design decisions
 *   2. Give feedback that improves the agents for next time
 *
 * Usage:
 *   node scripts/review.js                          # Reviews the latest build
 *   node scripts/review.js --build output/raw/2026-03-27_design-a-travel-app
 *   node scripts/review.js --why "Why did it build a calendar instead of a home screen?"
 *   node scripts/review.js --feedback "The brief said home screen but I got a calendar with bookable activities"
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import * as readline from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MODEL = "claude-sonnet-4-20250514";

// ─────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  magenta: "\x1b[35m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

function log(icon, msg, color = C.reset) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`${C.dim}${ts}${C.reset}  ${color}${icon}${C.reset}  ${msg}`);
}

// ─────────────────────────────────────────────────────────────
// Load the latest build
// ─────────────────────────────────────────────────────────────

function findLatestBuild(buildPrefix) {
  const rawDir = join(ROOT, "output", "raw");
  if (!existsSync(rawDir)) {
    throw new Error("No builds found. Run a build first: node scripts/build.js \"...\"");
  }

  const files = readdirSync(rawDir).sort().reverse();

  if (buildPrefix) {
    // Match specific build
    const slug = basename(buildPrefix);
    const research = files.find((f) => f.includes(slug) && f.endsWith("_research.md"));
    if (!research) throw new Error(`No build found matching: ${slug}`);
    const prefix = research.replace("_research.md", "");
    return loadBuild(rawDir, prefix);
  }

  // Find latest by looking for most recent research file
  const latestResearch = files.find((f) => f.endsWith("_research.md"));
  if (!latestResearch) throw new Error("No builds found in output/raw/");
  const prefix = latestResearch.replace("_research.md", "");
  return loadBuild(rawDir, prefix);
}

function loadBuild(rawDir, prefix) {
  const build = { prefix };

  const researchPath = join(rawDir, `${prefix}_research.md`);
  const ideationPath = join(rawDir, `${prefix}_ideation.md`);
  const prototypePath = join(rawDir, `${prefix}_prototype.html`);

  build.research = existsSync(researchPath) ? readFileSync(researchPath, "utf-8") : null;
  build.ideation = existsSync(ideationPath) ? readFileSync(ideationPath, "utf-8") : null;
  build.prototype = existsSync(prototypePath) ? readFileSync(prototypePath, "utf-8") : null;

  // Extract brief from the ideation file (it contains the original brief)
  if (build.ideation) {
    const briefMatch = build.ideation.match(/Original brief: "(.+?)"/);
    build.brief = briefMatch ? briefMatch[1] : prefix.replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/-/g, " ");
  } else {
    build.brief = prefix.replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/-/g, " ");
  }

  return build;
}

// ─────────────────────────────────────────────────────────────
// Load skills
// ─────────────────────────────────────────────────────────────

function loadSkill(agentId) {
  const skillPath = join(ROOT, "skills", agentId, "SKILL.md");
  return existsSync(skillPath) ? readFileSync(skillPath, "utf-8") : null;
}

// ─────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────

async function ask(client, systemPrompt, userMessage) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

// ─────────────────────────────────────────────────────────────
// WHY — Explain design decisions
// ─────────────────────────────────────────────────────────────

async function explainWhy(client, build, question) {
  log("◆", "Tracing design decisions...", C.magenta);

  const prompt = `You are Norman, a design director. A designer on your team is asking why a build turned out the way it did. Your job is to trace the decision chain — show exactly where each choice was made and by which agent.

Original brief: "${build.brief}"

--- RESEARCH AGENT OUTPUT ---
${build.research ? build.research.slice(0, 2000) : "(no research found)"}
--- END RESEARCH ---

--- DESIGN PARTNER OUTPUT ---
${build.ideation ? build.ideation.slice(0, 2000) : "(no ideation found)"}
--- END IDEATION ---

--- PROTOTYPE ---
${build.prototype ? build.prototype.slice(0, 1500) : "(no prototype found)"}
--- END PROTOTYPE ---

The designer is asking: "${question}"

Trace the decision chain:
1. What did the Research Agent find that influenced this direction?
2. What concept did the Design Partner recommend, and what insight drove it?
3. How did Production Design interpret that into the prototype?
4. Where did the chain go wrong relative to what the designer expected?

Be specific. Quote from the actual agent outputs. If an agent misinterpreted the brief, say so clearly and identify the exact point of divergence.

End with: what should have happened differently, and which agent's instructions need to change to prevent this.`;

  const response = await ask(client, "You are Norman, a design director who traces and explains design decisions.", prompt);
  return response;
}

// ─────────────────────────────────────────────────────────────
// FEEDBACK — Improve skills based on critique
// ─────────────────────────────────────────────────────────────

async function processFeedback(client, build, feedback) {
  log("◆", "Analyzing feedback against agent skills...", C.magenta);

  const researchSkill = loadSkill("research-agent");
  const designSkill = loadSkill("design-partner");
  const productionSkill = loadSkill("production-design");

  const prompt = `You are the Training Agent for a design team called Norman. A designer just reviewed a build and has feedback. Your job is to figure out which agent(s) caused the issue and propose specific SKILL.md changes.

Original brief: "${build.brief}"

Designer's feedback: "${feedback}"

--- RESEARCH AGENT OUTPUT ---
${build.research ? build.research.slice(0, 1500) : "(none)"}
--- END RESEARCH ---

--- DESIGN PARTNER OUTPUT ---
${build.ideation ? build.ideation.slice(0, 1500) : "(none)"}
--- END IDEATION ---

--- CURRENT SKILL FILES ---

Research Agent SKILL.md:
${researchSkill ? researchSkill.slice(0, 1000) : "(not found)"}

Design Partner SKILL.md:
${designSkill ? designSkill.slice(0, 1000) : "(not found)"}

Production Design SKILL.md:
${productionSkill ? productionSkill.slice(0, 1000) : "(not found)"}
--- END SKILLS ---

Analyze:
1. ROOT CAUSE: Which agent diverged from the brief? Was it the Research Agent surfacing the wrong patterns, the Design Partner making a bad creative leap, or Production Design misinterpreting the concept?

2. SPECIFIC CHANGES: For each agent that needs improvement, propose exact text to add or modify in their SKILL.md. Format as:

AGENT: [agent name]
FILE: skills/[agent-id]/SKILL.md  
SECTION: [which section to modify]
CHANGE: [exact instruction to add or modify]
REASONING: [why this prevents the problem from recurring]

3. PATTERN: Is this a one-off misinterpretation, or does it reveal a systematic gap in an agent's instructions?

Be specific and actionable. The changes should be things you could paste directly into the SKILL.md file.`;

  const response = await ask(client,
    "You are a Training Agent that improves AI design agents based on user feedback. You diagnose root causes and propose specific skill file changes.",
    prompt
  );
  return response;
}

// ─────────────────────────────────────────────────────────────
// Save feedback to log
// ─────────────────────────────────────────────────────────────

function saveFeedback(build, feedback, analysis) {
  const feedbackDir = join(ROOT, "training-history", "feedback");
  mkdirSync(feedbackDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const entry = {
    timestamp: new Date().toISOString(),
    build: build.prefix,
    brief: build.brief,
    feedback,
    analysis,
  };

  const filepath = join(feedbackDir, `${timestamp}_${build.prefix}.json`);
  writeFileSync(filepath, JSON.stringify(entry, null, 2));
  return filepath;
}

// ─────────────────────────────────────────────────────────────
// Interactive mode
// ─────────────────────────────────────────────────────────────

async function interactive(client, build) {
  console.log(`\n${C.magenta}${C.bold}◆ Norman — Build Review${C.reset}`);
  console.log(`${C.dim}  Build: ${build.prefix}${C.reset}`);
  console.log(`${C.dim}  Brief: "${build.brief}"${C.reset}`);
  console.log();
  console.log(`${C.bold}Commands:${C.reset}`);
  console.log(`  ${C.cyan}why${C.reset} <question>     Ask why Norman made a design choice`);
  console.log(`  ${C.yellow}feedback${C.reset} <text>   Give feedback to improve the agents`);
  console.log(`  ${C.dim}chain${C.reset}              Show the full decision chain summary`);
  console.log(`  ${C.dim}quit${C.reset}               Exit`);
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.magenta}norman>${C.reset} `,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === "quit" || input === "exit") {
      console.log();
      rl.close();
      return;
    }

    if (input === "chain") {
      console.log(`\n${C.bold}Decision Chain:${C.reset}\n`);

      if (build.research) {
        console.log(`${C.cyan}Research Agent${C.reset} found:`);
        // Show first 3 lines of substance
        const lines = build.research.split("\n").filter((l) => l.trim().length > 10).slice(0, 5);
        lines.forEach((l) => console.log(`  ${C.dim}${l.slice(0, 120)}${C.reset}`));
        console.log();
      }

      if (build.ideation) {
        console.log(`${C.yellow}Design Partner${C.reset} recommended:`);
        const lines = build.ideation.split("\n").filter((l) => l.trim().length > 10).slice(0, 5);
        lines.forEach((l) => console.log(`  ${C.dim}${l.slice(0, 120)}${C.reset}`));
        console.log();
      }

      if (build.prototype) {
        const titleMatch = build.prototype.match(/<title>(.*?)<\/title>/i);
        const charCount = build.prototype.length;
        console.log(`${C.green}Production Design${C.reset} built:`);
        console.log(`  ${C.dim}${titleMatch ? titleMatch[1] : "Untitled"} (${charCount} chars)${C.reset}`);
        console.log();
      }

      rl.prompt();
      return;
    }

    if (input.startsWith("why ")) {
      const question = input.slice(4).trim();
      if (!question) { console.log("  Usage: why <your question>"); rl.prompt(); return; }

      try {
        const explanation = await explainWhy(client, build, question);
        console.log(`\n${explanation}\n`);
      } catch (e) {
        console.log(`  ${C.yellow}Error: ${e.message}${C.reset}`);
      }
      rl.prompt();
      return;
    }

    if (input.startsWith("feedback ")) {
      const fb = input.slice(9).trim();
      if (!fb) { console.log("  Usage: feedback <your feedback>"); rl.prompt(); return; }

      try {
        const analysis = await processFeedback(client, build, fb);
        console.log(`\n${analysis}\n`);

        const filepath = saveFeedback(build, fb, analysis);
        log("✓", `Feedback saved: ${filepath}`, C.green);
        console.log();
      } catch (e) {
        console.log(`  ${C.yellow}Error: ${e.message}${C.reset}`);
      }
      rl.prompt();
      return;
    }

    // Default: treat as a "why" question
    try {
      const explanation = await explainWhy(client, build, input);
      console.log(`\n${explanation}\n`);
    } catch (e) {
      console.log(`  ${C.yellow}Error: ${e.message}${C.reset}`);
    }
    rl.prompt();
  });
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    build: { type: "string", short: "b" },
    why: { type: "string", short: "w" },
    feedback: { type: "string", short: "f" },
  },
});

const client = new Anthropic();

try {
  const build = findLatestBuild(values.build);

  if (values.why) {
    // One-shot why
    const explanation = await explainWhy(client, build, values.why);
    console.log(`\n${explanation}\n`);
  } else if (values.feedback) {
    // One-shot feedback
    const analysis = await processFeedback(client, build, values.feedback);
    console.log(`\n${analysis}\n`);
    const filepath = saveFeedback(build, values.feedback, analysis);
    log("✓", `Feedback saved: ${filepath}`, C.green);
  } else {
    // Interactive mode
    await interactive(client, build);
  }
} catch (e) {
  log("✗", e.message, "\x1b[31m");
  process.exit(1);
}
