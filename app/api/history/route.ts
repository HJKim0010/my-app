import { buildArchiveSessions, readArchiveTable } from "../../../backend/logs/historyArchive.ts";
import { privateHeaders, readSession, sameOrigin, verifiedAdmin } from "../../../backend/auth/historyAuth.ts";

const headers = privateHeaders;

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!sameOrigin(request)) {
    return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403, headers });
  }
  if (!await verifiedAdmin(readSession(request))) {
    return Response.json({ error: "선생님 계정으로 로그인해 주세요." }, { status: 401, headers });
  }
  const participantId = (url.searchParams.get("participant") || "").trim().toUpperCase();
  if (!/^P\d{2,}$/.test(participantId)) {
    return Response.json({ error: "참가자 ID를 P44와 같은 형식으로 입력해 주세요." }, { status: 400, headers });
  }
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    return Response.json({ error: "Supabase 연결 설정이 필요합니다. .env.local에 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정한 뒤 개발 서버를 재시작해 주세요." }, { status: 503, headers });
  }
  const results = await Promise.allSettled([
    readArchiveTable(base, key, process.env.SUPABASE_SESSION_TRANSCRIPTS_TABLE || "session_transcripts", participantId),
    readArchiveTable(base, key, process.env.SUPABASE_CHAT_EVENTS_TABLE || "chat_events", participantId),
  ]);
  const warnings = results.flatMap((result) => result.status === "rejected"
    ? [result.reason instanceof Error && result.reason.message.startsWith("Supabase ")
      ? result.reason.message : "일부 기록을 불러오지 못했습니다. 연결 상태와 조회 한도를 확인해 주세요."] : []);
  if (results.every((result) => result.status === "rejected")) {
    return Response.json({ error: warnings.join(" ") }, { status: 502, headers });
  }
  const [transcripts, events] = results.map((result) => result.status === "fulfilled" ? result.value : []);
  return Response.json({ participantId, sessions: buildArchiveSessions(transcripts, events, participantId), warnings }, { headers });
}
