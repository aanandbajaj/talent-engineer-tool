import { NextRequest } from "next/server";
import { getCandidate, sampleCareer, samplePapers } from "../../_data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // If this is a Supabase-sourced candidate id: sb:tw:<username>
  if (params.id.startsWith("sb:tw:")) {
    const username = params.id.replace("sb:tw:", "");
    const payload = {
      profile: {
        id: params.id,
        name: `@${username}`,
        affiliation: null,
        openalex_id: null,
        twitter_handle: `@${username}`,
      },
      papers: [] as any[],
      social_summary: null,
      evidence: [] as any[],
      career: { segments: [] as any[], samples: [] as any[] },
    };
    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  }

  const c = getCandidate(params.id);
  if (!c) return new Response(JSON.stringify({ detail: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  const idx = Number(params.id.split("_")[1] || 1);
  const career = sampleCareer(idx);
  const papers = samplePapers(idx);
  const payload = {
    profile: {
      id: c.id,
      name: c.name,
      affiliation: c.affiliation,
      openalex_id: `https://openalex.org/A${1000 + idx}`,
      twitter_handle: c.twitter_handle || null,
    },
    papers,
    social_summary: null,
    evidence: [],
    career,
  };
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
}
