import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || process.env.API_BASE || "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key") || "";
  const limit = searchParams.get("limit");

  if (!key) {
    return new Response(JSON.stringify({ detail: "catalog key is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const qs = new URLSearchParams({ key });
  if (limit) qs.set("limit", limit);

  const upstream = `${API_BASE.replace(/\/$/, "")}/catalog?${qs.toString()}`;

  try {
    const res = await fetch(upstream, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ detail: err?.message || "catalog fetch failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
