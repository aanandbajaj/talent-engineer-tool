// In-memory mock data and helpers for local frontend-only testing.
import { randomUUID } from "crypto";

export type MockCandidate = {
  id: string;
  name: string;
  affiliation?: string | null;
  topics: string[];
  score: number;
  seniority?: "junior" | "mid" | "senior" | "principal";
  twitter_handle?: string | null;
};

export type MockJob = {
  id: string;
  createdAt: number;
  status: "pending" | "running" | "done" | "error";
  progress: number; // 0..100
  results: MockCandidate[]; // accumulated so far
};

// Simple PRNG for stable mock scores
function rand(seed: number) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const CANDIDATE_POOL: MockCandidate[] = Array.from({ length: 14 }).map((_, i) => {
  const names = [
    "Ada Lovelace",
    "Alan Turing",
    "Marvin Minsky",
    "Geoffrey Hinton",
    "Yann LeCun",
    "Fei-Fei Li",
    "Demis Hassabis",
    "Andrew Ng",
    "Sara Hooker",
    "Chelsea Finn",
    "Pieter Abbeel",
    "Ilya Sutskever",
    "John Schulman",
    "Dario Amodei",
  ];
  const orgs = [
    "OpenAI",
    "DeepMind",
    "Google Research",
    "FAIR",
    "Stanford University",
    "UC Berkeley",
    "MIT CSAIL",
    "xAI",
  ];
  const topics = [
    "transformers",
    "multimodal",
    "reinforcement",
    "self-supervised",
    "reasoning",
    "vision",
    "RLHF",
    "alignment",
    "optimization",
  ];
  const s = 0.65 + rand(i + 2) * 0.35;
  const seniority = ((): MockCandidate["seniority"] => {
    const p = rand(i + 11);
    if (p > 0.8) return "principal";
    if (p > 0.55) return "senior";
    if (p > 0.3) return "mid";
    return "junior";
  })();
  return {
    id: `cand_${i + 1}`,
    name: names[i % names.length],
    affiliation: orgs[i % orgs.length],
    topics: Array.from({ length: 5 }).map((_, k) => topics[(i + k) % topics.length]),
    score: Number(s.toFixed(2)),
    seniority,
    twitter_handle: null,
  };
});

// Jobs storage (dev only; reset on HMR)
const JOBS = new Map<string, MockJob>();

export function createJob(): MockJob {
  const id = randomUUID();
  const job: MockJob = {
    id,
    createdAt: Date.now(),
    status: "running",
    progress: 1,
    results: [],
  };
  JOBS.set(id, job);
  return job;
}

export function getJob(id: string): MockJob | undefined {
  const job = JOBS.get(id);
  if (!job) return undefined;
  // Update progress based on elapsed time (simulate ~20 seconds total)
  const elapsed = Date.now() - job.createdAt;
  const pct = Math.min(100, Math.floor((elapsed / 20000) * 100));
  job.progress = Math.max(job.progress, pct);
  // Gradually add candidates
  const shouldCount = Math.floor((job.progress / 100) * CANDIDATE_POOL.length);
  const have = job.results.length;
  if (shouldCount > have) {
    const next = CANDIDATE_POOL.slice(0, shouldCount - have).map((c) => ({ ...c }));
    job.results.push(...next);
  }
  if (job.progress >= 100) job.status = "done";
  return job;
}

export function listCandidates(): MockCandidate[] {
  return CANDIDATE_POOL.map((c) => ({ ...c }));
}

export function getCandidate(id: string): MockCandidate | undefined {
  return CANDIDATE_POOL.find((c) => c.id === id);
}

export function updateCandidateHandle(id: string, handle: string | null) {
  const c = CANDIDATE_POOL.find((x) => x.id === id);
  if (c) c.twitter_handle = handle;
}

export function samplePapers(i: number) {
  const venues = ["NeurIPS", "ICML", "ICLR", "CVPR", "ACL", "Nature" ];
  return Array.from({ length: 8 }).map((_, k) => ({
    title: `On ${k % 2 ? "Scalable" : "Robust"} ${["Transformer", "Agent", "RL", "Vision"][k % 4]} Systems ${i}-${k}`,
    venue: venues[(i + k) % venues.length],
    year: 2016 + ((i + k) % 10),
    citations: 50 + (i * 13 + k * 7) % 600,
  }));
}

export function sampleCareer(i: number) {
  const orgs = ["University", "Startup Alpha", "DeepMind", "OpenAI", "xAI", "FAIR", "Google Research"];
  const start = 2016 + (i % 3);
  const segments: { org: string; start_year: number; end_year: number }[] = [];
  let y = start;
  for (let s = 0; s < 3; s++) {
    const len = 2 + ((i + s) % 3); // 2..4 years
    const org = orgs[(i + s) % orgs.length];
    segments.push({ org, start_year: y, end_year: y + len - 1 });
    y += len;
  }
  const samples = [] as { year: number; org: string; salary_usd: number; band: string; basis: string }[];
  for (const seg of segments) {
    for (let yy = seg.start_year; yy <= seg.end_year; yy++) {
      const band = seg.org.includes("University") ? "academia" : seg.org.match(/OpenAI|DeepMind|Google|FAIR|xAI/i) ? "industry-tier1" : "industry-other";
      const base = band === "academia" ? 140000 : band === "industry-tier1" ? 325000 : 220000;
      const yrs = Math.max(0, yy - 2016);
      const amount = Math.round(base * Math.pow(1.02, yrs));
      samples.push({ year: yy, org: seg.org, salary_usd: amount, band, basis: `mock ${band}` });
    }
  }
  return { segments, samples };
}

export function sampleTweets(id: string) {
  return Array.from({ length: 8 }).map((_, i) => ({
    post_id: `${id}_tweet_${i + 1}`,
    text: `Thoughts on agentic workflows and ${i % 2 ? "multimodal reasoning" : "RLHF"} #ai`,
    created_at: new Date(Date.now() - i * 86400000).toISOString(),
  }));
}

