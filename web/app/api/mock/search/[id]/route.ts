import { NextRequest } from "next/server";
import { getJob } from "../../_data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const job = getJob(params.id);
  if (!job) {
    return new Response(JSON.stringify({ detail: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  return new Response(
    JSON.stringify({ status: job.status, progress: job.progress, results: job.results.map(c => ({
      candidate_id: c.id,
      name: c.name,
      affiliation: c.affiliation,
      topics: c.topics,
      score: c.score,
      seniority: c.seniority,
    })) }),
    { headers: { "Content-Type": "application/json" } }
  );
}
