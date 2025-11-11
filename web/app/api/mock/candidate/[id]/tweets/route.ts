import { NextRequest } from "next/server";
import { sampleTweets } from "../../../_data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (params.id.startsWith("sb:tw:")) {
    return new Response(JSON.stringify({ tweets: [] }), { headers: { "Content-Type": "application/json" } });
  }

  const tweets = sampleTweets(params.id);
  return new Response(JSON.stringify({ tweets }), { headers: { "Content-Type": "application/json" } });
}
