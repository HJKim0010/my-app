import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TASKS = ["task1", "task2"];

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => value.trim()).filter(Boolean))];
}

function normalizeRuntimeEntry(entry) {
  const terms = unique([
    entry.canonical || "",
    ...(entry.terms || []),
    ...(entry.korean_terms || []),
    ...(entry.english_terms || []),
    ...(entry.mixed_terms || []),
    ...(entry.question_forms || []),
  ]);

  const related = unique([
    ...(entry.related || []),
    ...(entry.actions || []),
    ...(entry.feelings || []),
  ]);

  return {
    id: entry.id,
    category: entry.category,
    canonical: entry.canonical,
    terms,
    related,
    korean_terms: unique(entry.korean_terms || []),
    english_terms: unique(entry.english_terms || []),
    mixed_terms: unique(entry.mixed_terms || []),
    question_forms: unique(entry.question_forms || []),
    actions: unique(entry.actions || []),
    feelings: unique(entry.feelings || []),
    priority: entry.priority || 0,
    segments: unique(entry.segments || []),
  };
}

function buildTaskLexicon(taskId) {
  const sourcePath = path.join(ROOT, "data", taskId, `${taskId}-lexicon-source.json`);
  const runtimePath = path.join(ROOT, "data", taskId, `${taskId}-lexicon.json`);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source lexicon: ${sourcePath}`);
  }

  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const entries = Array.isArray(source.entries) ? source.entries.map(normalizeRuntimeEntry) : [];

  const runtime = {
    version: source.version || 2,
    taskId,
    entries,
  };

  fs.writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
  return { taskId, count: entries.length, runtimePath };
}

for (const taskId of TASKS) {
  const result = buildTaskLexicon(taskId);
  console.log(`Built ${result.taskId} lexicon with ${result.count} entries -> ${result.runtimePath}`);
}
