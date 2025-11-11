import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as any));
  const q = (body?.message || "").toString();
  const answer = `Mock answer for ${params.id}: Based on the retrieved tweets, the candidate often discusses agentic workflows, RLHF, and multimodal reasoning. [1][2]`;
  const citations = [
    { post_id: `${params.id}_tweet_1`, url: undefined },
    { post_id: `${params.id}_tweet_2`, url: undefined },
  ];
  return new Response(JSON.stringify({ answer, citations }), { headers: { "Content-Type": "application/json" } });
}
