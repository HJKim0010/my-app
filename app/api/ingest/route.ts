import { getTaskSessionStatus } from "@/backend/rag/loader";

export async function GET() {
  return Response.json({
    message:
      "Task ingest automation is not implemented yet. Place validated task assets into the matching data/task folders, then use the session status route to confirm readiness.",
    status: {
      task1: getTaskSessionStatus("task1"),
      task2: getTaskSessionStatus("task2"),
    },
  });
}
