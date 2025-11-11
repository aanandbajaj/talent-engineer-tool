import { NextRequest } from "next/server";
import { getJob } from "../../_data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const encoder = new TextEncoder();
  let tick = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: any) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      // initial ping
      send({ type: "progress", progress: 1 });
      const iv = setInterval(() => {
        tick += 1;
        const job = getJob(params.id);
        if (!job) {
          send({ type: "error", message: "job not found" });
          clearInterval(iv);
          controller.close();
          return;
        }
        send({ type: "progress", progress: job.progress });
        // emit one candidate event per tick if we have an unseen item
        const idx = job.results.length ? Math.min(job.results.length - 1, tick - 1) : -1;
        if (idx >= 0 && idx < job.results.length) {
          const c = job.results[idx];
          send({
            type: "candidate",
            candidate: {
              candidate_id: c.id,
              name: c.name,
              affiliation: c.affiliation,
              topics: c.topics,
              score: c.score,
              seniority: c.seniority,
            },
          });
        }
        if (job.status === "done") {
          send({ type: "finished" });
          clearInterval(iv);
          controller.close();
        }
      }, 1000);
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
