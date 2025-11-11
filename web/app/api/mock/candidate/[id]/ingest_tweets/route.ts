import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: NextRequest, _ctx: { params: { id: string } }) {
  // No-op in mock; pretend ingestion succeeded
  return new Response(JSON.stringify({ ok: true, ingested: 20 }), { headers: { "Content-Type": "application/json" } });
}
