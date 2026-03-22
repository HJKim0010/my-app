import { getTask1SessionStatus } from "@/backend/rag/loader";

export async function GET() {
  return Response.json({
    message:
      "Task1 ingest automation is not implemented yet. Place validated Task1 assets into the data/task1 static and dynamic folders, then use the session status route to confirm readiness.",
    status: getTask1SessionStatus(),
  });
}
