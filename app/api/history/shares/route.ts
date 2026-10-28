import { privateHeaders, readSession, sameOrigin, verifiedAdmin } from "../../../../backend/auth/historyAuth.ts";
import { createShare, listShares, parseShareScope, revokeShare } from "../../../../backend/logs/historyShares.ts";
import { parseShareExpiry } from "../../../../backend/logs/shareExpiry.ts";

async function authorize(request: Request, write = false) {
  if (!sameOrigin(request, write)) return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403, headers: privateHeaders });
  const admin = await verifiedAdmin(readSession(request));
  return admin || Response.json({ error: "선생님 계정으로 로그인해 주세요." }, { status: 401, headers: privateHeaders });
}
const badRequest = () => Response.json({ error: "선택한 대화와 공유 기간을 확인해 주세요." }, { status: 400, headers: privateHeaders });
const failure = (cause: unknown) => Response.json({ error: cause instanceof Error ? cause.message : "공유 요청을 처리하지 못했습니다." }, { status: 503, headers: privateHeaders });

export async function GET(request: Request) {
  const admin = await authorize(request);
  if (admin instanceof Response) return admin;
  const scope = parseShareScope(Object.fromEntries(new URL(request.url).searchParams));
  if (!scope) return badRequest();
  try { return Response.json({ shares: await listShares(scope) }, { headers: privateHeaders }); }
  catch (cause) { return failure(cause); }
}

export async function POST(request: Request) {
  const admin = await authorize(request, true);
  if (admin instanceof Response) return admin;
  let body;
  try { const text = await request.text(); if (text.length > 2048) return badRequest(); body = JSON.parse(text); }
  catch { return badRequest(); }
  const scope = parseShareScope(body);
  if (!scope || parseShareExpiry(body) === null) return badRequest();
  try { return Response.json(await createShare(scope, admin.email, body), { headers: privateHeaders }); }
  catch (cause) { return failure(cause); }
}

export async function DELETE(request: Request) {
  const admin = await authorize(request, true);
  if (admin instanceof Response) return admin;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return badRequest();
  try { await revokeShare(id); return Response.json({ ok: true }, { headers: privateHeaders }); }
  catch (cause) { return failure(cause); }
}
