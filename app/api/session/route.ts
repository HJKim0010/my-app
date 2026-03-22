import { NextRequest } from "next/server";
import { appendSessionTranscript } from "@/backend/logs/logger";
import { getTask1SessionStatus, loadTask1Package, type TaskCondition } from "@/backend/rag/loader";

export async function GET(request: NextRequest) {
  const conditionParam = request.nextUrl.searchParams.get("condition");
  const condition = conditionParam === "dynamic" ? "dynamic" : "static";
  const taskPackage = loadTask1Package(condition as TaskCondition);
  const status = getTask1SessionStatus();

  return Response.json({
    task_id: taskPackage.config.task_id,
    title: taskPackage.config.title,
    condition,
    condition_label: taskPackage.conditionLabel,
    status,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const condition = body?.condition === "dynamic" ? "dynamic" : "static";
  const taskPackage = loadTask1Package(condition as TaskCondition);
  const sessionStartedAt =
    typeof body?.sessionStartedAt === "number" ? body.sessionStartedAt : Date.now();

  await appendSessionTranscript({
    session_id: typeof body?.sessionId === "string" ? body.sessionId : "unknown-session",
    task_id: taskPackage.config.task_id,
    condition_label: taskPackage.conditionLabel,
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
