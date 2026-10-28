import { readShare, shareHeaders } from "../../../backend/logs/historyShares.ts";
import { sameOrigin } from "../../../backend/auth/historyAuth.ts";

export async function POST(request: Request) {
  if (!sameOrigin(request, true)) return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403, headers: shareHeaders });
  let body;
  try { const text = await request.text(); if (text.length > 1024) throw new Error(); body = JSON.parse(text); }
  catch { return Response.json({ error: "공유 링크를 확인해 주세요." }, { status: 400, headers: shareHeaders }); }
  try {
    const share = await readShare(body?.token, body?.checkOnly === true);
    if (!share) return Response.json({ error: "공유 링크가 만료되었거나 사용 중지되었습니다. 선생님에게 새 링크를 요청해 주세요." }, { status: 404, headers: shareHeaders });
    return Response.json(share, { headers: shareHeaders });
  } catch {
    return Response.json({ error: "대화를 불러오지 못했습니다. 잠시 후 새로고침해 주세요." }, { status: 503, headers: shareHeaders });
  }
}
