import { NextRequest } from "next/server";
import { updateCandidateHandle } from "../../../_data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as any));
  const handle = (body?.twitter_handle || "").toString().replace(/^@/, "");
  updateCandidateHandle(params.id, handle || null);
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}
