import { NextRequest } from "next/server";
import { createJob } from "../_data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // We ignore payload fields; this is a mock
  await req.json().catch(() => ({}));
  const job = createJob();
  return new Response(JSON.stringify({ search_id: job.id }), {
    headers: { "Content-Type": "application/json" },
  });
}
