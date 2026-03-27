import { NextRequest } from "next/server";
import { appendSessionTranscript } from "@/backend/logs/logger";
import {
  getTaskSessionStatus,
  loadTaskPackage,
  type TaskCondition,
  type TaskId,
} from "@/backend/rag/loader";

export async function GET(request: NextRequest) {
  const taskParam = request.nextUrl.searchParams.get("task");
  const conditionParam = request.nextUrl.searchParams.get("condition");
  const taskId: TaskId = taskParam === "task2" ? "task2" : "task1";
  const condition = conditionParam === "dynamic" ? "dynamic" : "static";
  const taskPackage = loadTaskPackage(taskId, condition as TaskCondition);
  const status = getTaskSessionStatus(taskId);

  return Response.json({
    task_id: taskPackage.config.task_id,
    title: taskPackage.config.title,
    source_mode: condition,
    condition_label: taskPackage.config.ai_condition,
    status,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const isFinal = body?.isFinal === true;
  const taskId: TaskId = body?.taskId === "task2" ? "task2" : "task1";
  const condition = body?.condition === "dynamic" ? "dynamic" : "static";
  const taskPackage = loadTaskPackage(taskId, condition as TaskCondition);
  const sessionStartedAt =
    typeof body?.sessionStartedAt === "number" ? body.sessionStartedAt : Date.now();

  if (!isFinal) {
    return Response.json({ ok: true, skipped: true });
  }

  await appendSessionTranscript({
    session_id: typeof body?.sessionId === "string" ? body.sessionId : "unknown-session",
    task_id: taskPackage.config.task_id,
    condition_label: taskPackage.config.ai_condition,
    timestamp: new Date().toISOString(),
    interaction_count:
      typeof body?.interactionCount === "number" ? body.interactionCount : 0,
    session_duration_ms: Math.max(0, Date.now() - sessionStartedAt),
    transcript: Array.isArray(body?.messages)
      ? body.messages
          .filter(
            (message: unknown) =>
              typeof message === "object" &&
              message !== null &&
              "role" in message &&
              "text" in message
          )
          .map((message: { role: "user" | "assistant"; text: string }) => ({
            role: message.role,
            text: message.text,
          }))
      : [],
  });

  return Response.json({ ok: true });
}
