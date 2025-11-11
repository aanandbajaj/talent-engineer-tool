import { NextRequest } from "next/server";

const TARGET_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ensureAbsoluteBase() {
  if (!TARGET_BASE || !TARGET_BASE.startsWith("http")) {
    throw new Error("Backend proxy requires NEXT_PUBLIC_API_BASE to be an absolute URL");
  }
  return TARGET_BASE.replace(/\/$/, "");
}

function buildTarget(path: string, search: string) {
  const base = ensureAbsoluteBase();
  const suffix = path ? `/${path}` : "";
  return `${base}${suffix}${search}`;
}

async function forward(req: NextRequest, method: string, path: string[]) {
  const target = buildTarget((path || []).join("/"), req.nextUrl.search);
  const headers = new Headers(req.headers);
  headers.delete("host");
  const init: RequestInit = {
    method,
    headers,
    cache: "no-store",
  };
  if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
    const body = await req.text();
    init.body = body;
  }
  const upstream = await fetch(target, init);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    return await forward(req, "GET", params.path || []);
  } catch (error: any) {
    return new Response(JSON.stringify({ detail: error?.message || "backend proxy failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(req: NextRequest, context: { params: { path: string[] } }) {
  try {
    return await forward(req, "POST", context.params.path || []);
  } catch (error: any) {
    return new Response(JSON.stringify({ detail: error?.message || "backend proxy failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function PUT(req: NextRequest, context: { params: { path: string[] } }) {
  try {
    return await forward(req, "PUT", context.params.path || []);
  } catch (error: any) {
    return new Response(JSON.stringify({ detail: error?.message || "backend proxy failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function DELETE(req: NextRequest, context: { params: { path: string[] } }) {
  try {
    return await forward(req, "DELETE", context.params.path || []);
  } catch (error: any) {
    return new Response(JSON.stringify({ detail: error?.message || "backend proxy failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
