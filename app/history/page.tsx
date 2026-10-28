import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName, verifiedAdmin } from "@/backend/auth/historyAuth";
import HistoryViewer from "./HistoryViewer";

export default async function HistoryPage() {
  const user = await verifiedAdmin((await cookies()).get(sessionCookieName())?.value || "");
  if (!user) redirect("/history/login");
  return <HistoryViewer adminEmail={user.email} />;
}
