export type QueryType = "allowed" | "restricted";

export function classifyQuery(query: string): QueryType {
  const q = query.toLowerCase();

  if (
    q.includes("write") ||
    q.includes("continue") ||
    q.includes("paragraph") ||
    q.includes("rewrite") ||
    q.includes("fix") ||
    q.includes("correct")
  ) {
    return "restricted";
  }

  return "allowed";
}