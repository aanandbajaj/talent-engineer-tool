"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
// Note: keep chat UI minimal; no shadcn/prompt-kit for stability
import logo from "../assets/logo_black.png";

const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
const API_BASE = RAW_API_BASE && RAW_API_BASE.startsWith("http")
  ? "/api/backend"
  : RAW_API_BASE || (typeof window !== "undefined" ? `${window.location.origin}/api/mock` : "http://localhost:3000/api/mock");

type Candidate = {
  candidate_id: string;
  name: string;
  affiliation?: string | null;
  topics: string[];
  score?: number | null;
  seniority?: string | null;
};

type CandidateDetail = {
  profile: {
    id: string;
    name: string;
    affiliation?: string | null;
    organization?: string | null;
    country?: string | null;
    scholar_url?: string | null;
    linkedin_url?: string | null;
    openalex_id?: string | null;
    twitter_handle?: string | null;
    openalex_url?: string | null;
  };
  papers: { title: string; venue?: string | null; year?: number | null; citations?: number | null }[];
  career: {
    segments: { org: string; start_year: number; end_year: number }[];
    samples: { year: number; org: string; salary_usd: number; band: string }[];
  };
};

type LIProfile = {
  person: {
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    headline: string | null;
    location: string | null;
    profile_photo_url: string | null;
    public_identifier: string | null;
    linkedin_url: string | null;
  };
  summary: string | null;
  follower_count: number | null;
  connections_count: number | null;
  skills: { name: string; endorsements: number }[];
  languages: { name: string; proficiency?: string | null }[];
  education: { school: string | null; start: string | null; end: string | null }[];
  work: { company: string | null; title: string | null; location: string | null; start: string | null; end: string | null; description?: string | null }[];
  websites: string[];
};

type SearchStatus = "idle" | "pending" | "running" | "done" | "error";

const STATUS_LABELS: Record<SearchStatus, string> = {
  idle: "Idle",
  pending: "Starting",
  running: "Running",
  done: "Completed",
  error: "Error",
};

function normalizeStatus(value: unknown): SearchStatus {
  if (value === "pending" || value === "running" || value === "done" || value === "error") {
    return value;
  }
  return "running";
}

export default function HomePage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogStage, setDialogStage] = useState<"form" | "progress">("form");
  // Catalog mode: prebuilt lists instead of free-text JD/title search
  const [catalogTitle, setCatalogTitle] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState<string | null>(null);
  // Legacy inputs (retained but unused)
  const [jobTitle, setJobTitle] = useState("");
  const [jobNotes, setJobNotes] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [searchId, setSearchId] = useState<string | null>(null);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "career" | "chat">("profile");
  const [liProfile, setLiProfile] = useState<LIProfile | null>(null);
  const [liLoading, setLiLoading] = useState(false);
  const [liError, setLiError] = useState<string | null>(null);

  const seen = useRef<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const sorted = useMemo(() => {
    if (!candidateSearch.trim()) return [...candidates];
    const query = candidateSearch.toLowerCase();
    return candidates.filter(c => 
      c.name.toLowerCase().includes(query) || 
      c.affiliation?.toLowerCase().includes(query) ||
      c.topics?.some(t => t.toLowerCase().includes(query))
    );
  }, [candidates, candidateSearch]);
  const selectedCandidate = useMemo(
    () => sorted.find((c) => c.candidate_id === selectedId) ?? null,
    [sorted, selectedId]
  );
  const effectiveProgress = status === "done" ? 100 : Math.min(100, Math.max(progress, 0));

  const openDialog = () => {
    const hasActiveSearch = status === "pending" || status === "running";
    setDialogStage(hasActiveSearch ? "progress" : "form");
    setDialogError(null);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
  };

  const toggleDialog = () => {
    if (dialogOpen) {
      closeDialog();
    } else {
      openDialog();
    }
  };

  useEffect(() => {
    if (!dialogOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        closeDialog();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dialogOpen]);

  const handleStartSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = jobTitle.trim();
    if (!trimmed) {
      setDialogError("Enter a job title to start searching.");
      return;
    }

    setDialogError(null);
    setDialogStage("progress");
    setStatus("pending");
    setProgress(0);
    setSearchError(null);
    seen.current = new Set();

    try {
      const payload: Record<string, unknown> = {
        query: trimmed,
      };
      if (jobNotes.trim()) {
        payload.job_description = jobNotes.trim();
      }
      const resp = await fetch(`${API_BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.detail || "Failed to start search.");
      }
      setSearchId(data.search_id);
    } catch (err: any) {
      setDialogStage("form");
      setStatus("idle");
      setDialogError(err?.message || "Failed to start search.");
    }
  };

  // Load a pre-defined catalog from Supabase via our API route
  const loadCatalog = async (key: string) => {
    try {
      setDialogError(null);
      setLoadingCatalog(key);
      // Reset previous search state
      setSearchId(null);
      setStatus("pending");
      setProgress(0);
      setCandidates([]);
      setSelectedId(null);
      setDetail(null);
      setDetailError(null);
      setActiveTab("profile");
      const resp = await fetch(`/api/catalog?key=${encodeURIComponent(key)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.detail || "Failed to load list");
      const items = Array.isArray(data?.candidates) ? (data.candidates as Candidate[]) : [];
      setCandidates(items);
      setCatalogTitle((data?.label as string) || "Catalog");
      setStatus("done");
      setProgress(100);
      setDialogOpen(false);
    } catch (err: any) {
      setDialogError(err?.message || "Failed to load list");
      setStatus("error");
    } finally {
      setLoadingCatalog(null);
    }
  };

  useEffect(() => {
    if (!searchId) return;

    let active = true;
    setStatus("pending");
    setProgress(0);
    setSearchError(null);
    setCandidates([]);
    setSelectedId(null);
    setDetail(null);
    setLiProfile(null);
    setLiError(null);
    setLiLoading(false);
    setDetailError(null);
    setDetailLoading(false);
    setActiveTab("profile");
    seen.current = new Set();

    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/search/${searchId}`);
        if (!active) return;
        if (!response.ok) {
          throw new Error(`Status check failed (${response.status}).`);
        }
        const data = await response.json();
        if (!active) return;

        const nextStatus = normalizeStatus(data?.status);
        setStatus(nextStatus);
        if (typeof data?.progress === "number") {
          setProgress((prev) => Math.max(prev, data.progress));
        }
        if (Array.isArray(data?.results)) {
          setCandidates((prev) => {
            const map = new Map(prev.map((c) => [c.candidate_id, c]));
            for (const c of data.results as Candidate[]) {
              map.set(c.candidate_id, c);
            }
            return Array.from(map.values());
          });
        }
        if (nextStatus === "error") {
          setSearchError((data as any)?.error || "Search failed.");
        }
      } catch (err: any) {
        if (!active) return;
        setSearchError(err?.message || "Unable to refresh search status.");
      }
    };

    poll();
    const interval = setInterval(poll, 8000);

    const es = new EventSource(`${API_BASE}/events/${searchId}`);
    es.onmessage = (event) => {
      if (!active) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "progress" && typeof message.progress === "number") {
          setProgress((prev) => Math.max(prev, message.progress));
          setStatus((prev) => (prev === "pending" || prev === "idle" ? "running" : prev));
        }
        if (message.type === "candidate" && message.candidate) {
          const candidate: Candidate = message.candidate;
          if (!seen.current.has(candidate.candidate_id)) {
            seen.current.add(candidate.candidate_id);
            setCandidates((prev) => {
              const map = new Map(prev.map((c) => [c.candidate_id, c]));
              map.set(candidate.candidate_id, candidate);
              return Array.from(map.values());
            });
          }
        }
        if (message.type === "finished") {
          setStatus("done");
          setProgress(100);
        }
        if (message.type === "error") {
          setStatus("error");
          setSearchError(message.message || "Search failed.");
        }
      } catch {
        // ignore malformed SSE chunks
      }
    };
    es.onerror = () => {
      if (!active) return;
      // keep polling as fallback
    };

    return () => {
      active = false;
      clearInterval(interval);
      es.close();
    };
  }, [searchId]);

  useEffect(() => {
    if (!sorted.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !sorted.some((c) => c.candidate_id === selectedId)) {
      setSelectedId(sorted[0].candidate_id);
      setActiveTab("profile");
    }
  }, [sorted, selectedId]);

  useEffect(() => {
    let aborted = false;
    if (!selectedId) {
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
      return;
    }

    setDetail(null); // Clear old data immediately
    setLiProfile(null); // Clear LinkedIn profile too
    setDetailLoading(true);
    setDetailError(null);

    const load = async () => {
      try {
        const resp = await fetch(`${API_BASE}/candidate/${encodeURIComponent(selectedId)}`);
        if (!resp.ok) {
          throw new Error("Failed to load candidate details.");
        }
        const data = (await resp.json()) as CandidateDetail;
        if (!aborted) {
          setDetail(data);
        }
      } catch (err: any) {
        if (!aborted) {
          setDetailError(err?.message || "Failed to load candidate details.");
        }
      } finally {
        if (!aborted) {
          setDetailLoading(false);
        }
      }
    };

    load();
    return () => {
      aborted = true;
    };
  }, [selectedId]);

  useEffect(() => {
    let aborted = false;
    const handle = detail?.profile?.twitter_handle;
    if (!handle) {
      setLiProfile(null);
      setLiLoading(false);
      setLiError(null);
      return;
    }
    const uname = handle.replace(/^@/, "");
    setLiLoading(true);
    setLiError(null);
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/linkedin/${encodeURIComponent(uname)}`);
        if (!r.ok) throw new Error((await r.json())?.detail || "LinkedIn not found");
        const payload = await r.json();
        if (!aborted) setLiProfile(payload.profile as LIProfile);
      } catch (e: any) {
        if (!aborted) setLiError(e?.message || "Failed to load LinkedIn profile");
      } finally {
        if (!aborted) setLiLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [detail?.profile?.twitter_handle]);

  const preview = sorted.slice(0, 6);

  return (
    <>
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between border-b border-[#1f1f22] px-8 py-6">
          <div className="flex items-center gap-4">
            <Image
              src={logo}
              alt="xAI logo"
              width={48}
              height={48}
              priority
              className="h-10 w-10 rounded-sm"
            />
            <div>
              <div className="text-xl font-semibold tracking-tight text-accent">Talent Engineer</div>
              <div className="text-xs uppercase tracking-[0.24em] text-subtle">dashboard</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/network"
              className="rounded-md border border-[#2a2a2d] bg-[#1f1f22] px-4 py-2 text-sm font-medium text-accent transition hover:bg-[#2a2a2d]"
            >
              Network
            </a>
            <button
              ref={triggerRef}
              onClick={toggleDialog}
              aria-haspopup="menu"
              aria-expanded={dialogOpen}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-black transition hover:bg-accent/90"
            >
              New Search
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside className="flex w-full max-w-xs flex-col border-r border-[#1f1f22] bg-[#111113] px-6 py-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-subtle">{catalogTitle ? "Catalog" : "Search Status"}</div>
              {searchId ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-accent">{STATUS_LABELS[status]}</span>
                    <span className="text-subtle">{Math.round(effectiveProgress)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1f1f22]">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                      style={{ width: `${effectiveProgress}%` }}
                    />
                  </div>
                  <div className="text-xs text-subtle">#{searchId.slice(0, 8)}</div>
                </div>
              ) : catalogTitle ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-accent">{catalogTitle}</span>
                    <span className="text-subtle">{sorted.length} loaded</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1f1f22]">
                    <div className="h-full rounded-full bg-accent" style={{ width: `100%` }} />
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-subtle leading-relaxed">
                  Start a search to populate ranked candidates.
                </p>
              )}
            </div>

            {searchError && (
              <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {searchError}
              </div>
            )}

            <div className="mt-6 flex-1 overflow-y-auto pr-2">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-xs uppercase tracking-wide text-subtle">Search Results</div>
                {candidates.length > 0 && (
                  <div className="text-xs text-subtle">{sorted.length} of {candidates.length}</div>
                )}
              </div>
              {candidates.length > 0 && (
                <input
                  type="text"
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  placeholder="Filter by name, org, or topic..."
                  className="w-full mb-3 rounded border border-[#2a2a2d] bg-[#0b0b0f] px-3 py-2 text-sm text-white placeholder-subtle outline-none focus:border-accent"
                />
              )}
              {sorted.length === 0 ? (
                <div className="text-sm text-subtle">
                  {status === "idle" && !catalogTitle ? "No searches yet." : catalogTitle ? "No results in this list." : "Waiting for candidates…"}
                </div>
              ) : (
                <div className="space-y-2">
                  {sorted.map((candidate) => {
                    const active = candidate.candidate_id === selectedId;
                    return (
                      <button
                        key={candidate.candidate_id}
                        onClick={() => {
                          setSelectedId(candidate.candidate_id);
                          setActiveTab("profile");
                        }}
                        className={`w-full rounded-lg border border-transparent px-3 py-3 text-left transition ${
                          active
                            ? "border-accent bg-card"
                            : "border-[#1f1f22] bg-[#0b0b0f] hover:border-[#2a2a2d]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-semibold tracking-tight text-accent">{candidate.name}</div>
                            {candidate.affiliation && (
                              <div className="text-xs text-subtle">{candidate.affiliation}</div>
                            )}
                            {candidate.topics?.length > 0 && (
                              <div className="mt-2 text-xs text-subtle">
                                {candidate.topics.slice(0, 6).join(", ")}
                              </div>
                            )}
                          </div>
                          <div className="text-right text-xs text-subtle">{candidate.seniority || ""}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <section className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-8 py-8">
              {selectedId && selectedCandidate ? (
                <div className="space-y-6">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="text-2xl font-semibold tracking-tight text-accent">
                        {detail?.profile?.name ?? selectedCandidate.name}
                      </div>
                      {(detail?.profile?.affiliation || selectedCandidate.affiliation) && (
                        <div className="text-sm text-subtle">
                          {detail?.profile?.affiliation ?? selectedCandidate.affiliation}
                        </div>
                      )}
                      {selectedCandidate.topics?.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedCandidate.topics.slice(0, 8).map((topic) => (
                            <span
                              key={topic}
                              className="rounded-full bg-[#1f1f22] px-2 py-1 text-xs text-subtle"
                            >
                              {topic}
                            </span>
                          ))}
                        </div>
                      )}
                      {detail?.profile && (
                        <div className="mt-4 flex flex-wrap gap-3">
                          {detail.profile.twitter_handle && (
                            <a
                              href={`https://twitter.com/${detail.profile.twitter_handle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-subtle transition-colors"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                              </svg>
                              Twitter
                            </a>
                          )}
                          {detail.profile.linkedin_url && (
                            <a
                              href={detail.profile.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-subtle transition-colors"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                              </svg>
                              LinkedIn
                            </a>
                          )}
                          {detail.profile.scholar_url && (
                            <a
                              href={detail.profile.scholar_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-subtle transition-colors"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M5.242 13.769L0 9.5 12 0l12 9.5-5.242 4.269C17.548 11.249 14.978 9.5 12 9.5c-2.977 0-5.548 1.748-6.758 4.269zM12 10a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"/>
                              </svg>
                              Google Scholar
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-stretch gap-3 md:items-end">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setActiveTab("profile")}
                          className={`rounded px-3 py-2 text-sm transition border ${
                            activeTab === "profile"
                              ? "bg-accent text-black border-accent"
                              : "border-[#2a2a2d] text-subtle hover:text-accent"
                          }`}
                        >
                          Profile
                        </button>
                        <button
                          onClick={() => setActiveTab("career")}
                          className={`rounded px-3 py-2 text-sm transition border ${
                            activeTab === "career"
                              ? "bg-accent text-black border-accent"
                              : "border-[#2a2a2d] text-subtle hover:text-accent"
                          }`}
                        >
                          Career
                        </button>
                        <button
                          onClick={() => setActiveTab("chat")}
                          className={`rounded px-3 py-2 text-sm transition border ${
                            activeTab === "chat"
                              ? "bg-accent text-black border-accent"
                              : "border-[#2a2a2d] text-subtle hover:text-accent"
                          }`}
                        >
                          Chat
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    {/* top tabs removed in favor of right-side mini nav */}
                    <div className="min-h-[360px] rounded-b border border-[#2a2a2d] border-t-0 bg-card px-4 py-5">
                      {detailLoading && (
                        <div className="flex flex-col items-center justify-center py-20">
                          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
                          <div className="text-sm text-subtle">Loading candidate details…</div>
                        </div>
                      )}
                      {detailError && !detailLoading && (
                        <div className="text-sm text-red-300">{detailError}</div>
                      )}
                      {!detail && !detailLoading && !detailError && (
                        <div className="text-sm text-subtle">
                          Details are not ready yet. Check back in a moment.
                        </div>
                      )}
                      {detail && !detailLoading && !detailError && (
                        <>
                          {activeTab === "profile" && (
                            liProfile ? (
                              <LinkedInProfileView profile={liProfile} />
                            ) : (
                              <ProfileTab detail={detail} />
                            )
                          )}
                          {activeTab === "career" && (
                            <CareerTabMain career={detail.career} profile={detail.profile} />
                          )}
                          {activeTab === "chat" && (
                            <TweetsTab
                              candidateId={selectedId}
                              twitterHandle={detail.profile.twitter_handle || undefined}
                            />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center text-subtle">
                  <p className="text-lg font-medium text-accent">No search yet.</p>
                  <p className="mt-2 text-sm">Click New Search to discover candidates.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {dialogOpen && (
        <div className="pointer-events-none fixed inset-0 z-40">
          <div
            ref={dropdownRef}
            className="pointer-events-auto absolute right-8 top-[88px] w-full max-w-sm overflow-hidden rounded-2xl border border-[#2a2a2d] bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#2a2a2d] px-5 py-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-subtle">New Search</div>
                <div className="text-lg font-semibold text-accent">Choose a prebuilt list</div>
              </div>
              <button
                onClick={closeDialog}
                className="rounded border border-transparent px-2 py-1 text-subtle transition hover:border-[#2a2a2d] hover:text-accent"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4">
              {dialogStage === "form" ? (
                <div>
                  <div className="mb-3 text-xs uppercase tracking-wide text-subtle">Featured Lists</div>
                  <div className="grid grid-cols-1 gap-3">
                    {[
                      { key: "ai_researchers", label: "AI Researchers", desc: "From Supabase", disabled: false },
                      { key: "ml_engineers", label: "ML Engineers", desc: "Coming soon", disabled: true },
                      { key: "backend_engineers", label: "Backend Engineers", desc: "Coming soon", disabled: true },
                      { key: "frontend_engineers", label: "Frontend Engineers", desc: "Coming soon", disabled: true },
                    ].map((c) => (
                      <button
                        key={c.key}
                        disabled={c.disabled || loadingCatalog === c.key}
                        onClick={() => loadCatalog(c.key)}
                        className={`rounded-lg border px-4 py-3 text-left transition ${
                          c.disabled
                            ? "cursor-not-allowed border-[#2a2a2d] bg-[#0b0b0f] text-subtle"
                            : "border-[#2a2a2d] bg-[#111113] hover:border-[#3a3a3d]"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-accent">{c.label}</div>
                            <div className="text-xs text-subtle">{c.desc}</div>
                          </div>
                          {!c.disabled && (
                            <span className="text-xs text-subtle">
                              {loadingCatalog === c.key ? "Loading…" : "Load"}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  {dialogError && (
                    <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                      {dialogError}
                    </div>
                  )}
                </div>
              ) : status === "error" ? (
                <div className="space-y-4">
                  <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3">
                    <div className="text-sm font-semibold text-red-300">Search failed</div>
                    <div className="mt-1 text-xs text-red-200">
                      {searchError || "Something went wrong while running the search."}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => {
                        setDialogStage("form");
                        setStatus("idle");
                        if (searchError) setDialogError(searchError);
                      }}
                      className="rounded-md border border-[#2a2a2d] px-3 py-1 text-xs text-subtle transition hover:border-[#3a3a3d]"
                    >
                      Back
                    </button>
                    <button
                      onClick={closeDialog}
                      className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-black transition hover:bg-accent/90"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    {status === "done" ? (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#10341f] text-green-300">
                        <CheckIcon />
                      </div>
                    ) : (
                      <div className="h-12 w-12 rounded-full border-2 border-accent/25 border-t-accent animate-spin" />
                    )}
                    <div>
                      <div className="text-xs uppercase tracking-wide text-subtle">
                        {status === "done" ? "Completed" : "Searching"}
                      </div>
                      <div className="text-lg font-semibold text-accent">
                        {status === "done" ? "Results ready" : "Finding matching candidates…"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs text-subtle">
                      <span>{searchId ? `#${searchId.slice(0, 8)}` : "—"}</span>
                      <span>{Math.round(effectiveProgress)}%</span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#1f1f22]">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                        style={{ width: `${effectiveProgress}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-wide text-subtle">Streaming results</div>
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-[#2a2a2d] bg-[#0b0b0f] px-3 py-2 text-sm leading-6 text-subtle">
                      {preview.length === 0 ? (
                        <div>Waiting for candidates…</div>
                      ) : (
                        preview.map((item, idx) => (
                          <div key={item.candidate_id} className="flex items-center justify-between gap-3">
                            <span className="text-accent">{item.name}</span>
                            <span className="text-xs text-subtle">{(idx + 1).toString().padStart(2, "0")}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 text-xs text-subtle">
                    <span className="flex-1">
                      Results keep streaming into the dashboard even if you hide this menu.
                    </span>
                    <button
                      onClick={closeDialog}
                      className="rounded-md border border-[#2a2a2d] px-3 py-1 text-xs text-subtle transition hover:border-[#3a3a3d]"
                    >
                      {status === "done" ? "Close and review" : "Hide"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProfileTab({ detail }: { detail: CandidateDetail }) {
  const p = detail.profile;
  const papers = detail.papers || [];
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-semibold tracking-tight text-accent">{p.name}</div>
        {p.affiliation && (
          <div className="text-sm text-subtle">{p.affiliation}</div>
        )}
        {p.openalex_id && (
          <div className="mt-1 text-xs text-subtle">OpenAlex: {p.openalex_id}</div>
        )}
      </div>
      <div>
        <div className="mb-2 text-sm text-subtle">Top papers</div>
        <ul className="space-y-2">
          {papers.slice(0, 8).map((x, i) => (
            <li key={i} className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium text-accent">{x.title}</div>
                <div className="text-xs text-subtle">
                  {x.venue || ""} {x.year ? `· ${x.year}` : ""}
                </div>
              </div>
              <div className="text-right text-xs text-subtle">{(x.citations ?? 0)} cites</div>
            </li>
          ))}
          {papers.length === 0 && <li className="text-sm text-subtle">No publications found.</li>}
        </ul>
      </div>
    </div>
  );
}

function LinkedInProfileView({ profile }: { profile: LIProfile }) {
  const p = profile.person;
  const work = profile.work || [];
  const education = profile.education || [];
  const topSkills = (profile.skills || []).slice(0, 12);
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        {p.profile_photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.profile_photo_url} alt={p.full_name || "profile"} className="h-14 w-14 rounded" />
        )}
        <div>
          <div className="text-xl font-semibold tracking-tight text-accent">{p.full_name || "(Unknown)"}</div>
          {p.headline && <div className="text-sm text-subtle">{p.headline}</div>}
          {(p.location || profile.connections_count || profile.follower_count) && (
            <div className="mt-1 text-xs text-subtle">
              {[p.location, profile.connections_count ? `${profile.connections_count} connections` : null, profile.follower_count ? `${profile.follower_count} followers` : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
        </div>
      </div>
      {profile.summary && (
        <div>
          <div className="mb-1 text-sm text-subtle">About</div>
          <div className="text-sm text-accent whitespace-pre-wrap">{profile.summary}</div>
        </div>
      )}
      {topSkills.length > 0 && (
        <div>
          <div className="mb-1 text-sm text-subtle">Top skills</div>
          <div className="flex flex-wrap gap-2">
            {topSkills.map((s) => (
              <span key={s.name} className="rounded-full bg-[#1f1f22] px-2 py-1 text-xs text-subtle">
                {s.name}{s.endorsements ? ` · ${s.endorsements}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      {work.length > 0 && (
        <div>
          <div className="mb-1 text-sm text-subtle">Experience</div>
          <ul className="divide-y divide-[#2a2a2d] text-sm">
            {work.slice(0, 10).map((w, i) => (
              <li key={i} className="py-2">
                <div className="font-medium text-accent">{w.title || "(Role)"}</div>
                <div className="text-subtle">{[w.company, w.location].filter(Boolean).join(" · ")}</div>
                <div className="text-xs text-subtle">{[w.start, w.end || "present"].filter(Boolean).join(" – ")}</div>
                {w.description && <div className="mt-1 text-xs text-subtle whitespace-pre-wrap">{w.description}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {education.length > 0 && (
        <div>
          <div className="mb-1 text-sm text-subtle">Education</div>
          <ul className="space-y-1 text-sm">
            {education.slice(0, 6).map((e, i) => (
              <li key={i} className="text-subtle">
                <span className="text-accent">{e.school}</span>
                {" "}
                <span className="text-xs">{[e.start, e.end].filter(Boolean).join(" – ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CareerTab({ detail }: { detail: CandidateDetail }) {
  const samples = detail.career?.samples || [];
  const segments = detail.career?.segments || [];
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-sm text-subtle">Estimated total compensation over time</div>
        <CareerChart samples={samples} />
        <div className="mt-2 text-xs text-subtle">Heuristic bands; prototype only.</div>
      </div>
      <div>
        <div className="mb-1 text-sm text-subtle">Affiliations</div>
        {segments.length === 0 && (
          <div className="text-sm text-subtle">No affiliation timeline.</div>
        )}
        <ul className="text-sm">
          {segments.map((s, i) => (
            <li key={i} className="flex items-center justify-between border-b border-[#2a2a2d] py-1">
              <span className="text-accent">{s.org}</span>
              <span className="text-subtle">{s.start_year} – {s.end_year}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TweetsTab({ candidateId, twitterHandle }: { candidateId: string; twitterHandle?: string }) {
  return (
    <div className="space-y-4">
      <GrokChat candidateId={candidateId} handle={twitterHandle} />
    </div>
  );
}

function CareerChart({ samples }: { samples: any[] }) {
  if (!samples?.length) return <div className="text-sm text-subtle">No career data yet.</div>;
  const sorted = [...samples].sort((a, b) => a.year - b.year);
  const max = Math.max(...sorted.map((s) => s.salary_usd || 0), 1);
  const W = 720, H = 180, P = 24;
  const years = sorted.map((s) => s.year);
  const minYear = Math.min(...years), maxYear = Math.max(...years);
  const x = (y: number) => P + ((y - minYear) / Math.max(1, maxYear - minYear)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const path = sorted.map((s, i) => `${i ? "L" : "M"} ${x(s.year)} ${y(s.salary_usd || 0)}`).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} className="block">
        <rect x={0} y={0} width={W} height={H} fill="#111113" />
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="#2a2a2d" />
        <line x1={P} y1={P} x2={P} y2={H - P} stroke="#2a2a2d" />
        <text x={P} y={P - 6} fontSize="10" fill="#9b9ba1">
          ${Math.round(max / 1000)}k
        </text>
        <text x={P} y={H - 6} fontSize="10" fill="#9b9ba1">
          {minYear}
        </text>
        <text x={W - 28} y={H - 6} fontSize="10" fill="#9b9ba1">
          {maxYear}
        </text>
        <path d={path} stroke="#e8e8ea" fill="none" strokeWidth={2} />
        {sorted.map((s, i) => (
          <g key={i}>
            <circle cx={x(s.year)} cy={y(s.salary_usd || 0)} r={2.5} fill="#e8e8ea" />
          </g>
        ))}
      </svg>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-subtle">
        {sorted.map((s, i) => (
          <div key={i} className="flex items-center justify-between">
            <span>{s.year} · {s.org}</span>
            <span>${Math.round((s.salary_usd || 0) / 1000)}k</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GrokChat({ candidateId, handle }: { candidateId: string; handle?: string }) {
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      if (container.scrollHeight > container.clientHeight) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, [history, loading]);

  const ask = async () => {
    const q = input.trim();
    if (!q) return;
    setInput("");
    setHistory((h) => [...h, { role: "user", content: q }]);
    setLoading(true);
    try {
      let url = `${API_BASE}/candidate/${candidateId}/chat`;
      if (candidateId.startsWith("sb:tw:")) {
        const uname = (handle || candidateId.replace("sb:tw:", "")).replace(/^@/, "");
        if (!uname) {
          setHistory((h) => [...h, { role: "assistant", content: "Insufficient data (no Twitter handle)." }]);
          setLoading(false);
          return;
        }
        url = `${API_BASE}/chat/twitter/${encodeURIComponent(uname)}`;
      }
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      const data = await r.json();
      const answer = data?.answer || "(no answer)";
      const cits = (data?.citations || []) as { post_id: string; url?: string }[];
      const citeText = cits
        .map((c: any, i: number) => (c.url ? `[${i + 1}] ${c.url}` : `[${i + 1}] ${c.post_id}`))
        .join("  ");
      setHistory((h) => [...h, { role: "assistant", content: `${answer}\n\n${citeText}` }]);
    } catch (e: any) {
      setHistory((h) => [...h, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div ref={scrollRef} className="min-h-[20rem] h-[28rem] sm:h-[32rem] overflow-y-auto rounded border border-[#2a2a2d] bg-[#111113] p-3">
        {history.length === 0 && (
          <div className="text-sm text-subtle">
            Ask about topics they discuss on X. We’ll ground answers in their tweets.
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`mb-2 ${m.role === "user" ? "text-accent" : "text-subtle"}`}>
            <span className="mr-2 text-xs">{m.role === "user" ? "You" : "Grok"}</span>
            <span className="whitespace-pre-wrap">{m.content}</span>
          </div>
        ))}
        {loading && <div className="text-xs text-subtle">Grok is thinking…</div>}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          className="flex-1 rounded border border-[#2a2a2d] bg-[#0b0b0f] px-3 py-2 text-sm text-accent outline-none focus:border-accent"
          placeholder="e.g., What topics do they discuss most?"
        />
        <button
          onClick={ask}
          disabled={loading || !input.trim()}
          className="rounded bg-accent px-3 py-2 text-sm text-black transition hover:bg-accent/90 disabled:opacity-50"
        >
          Ask
        </button>
      </div>
      {!handle && (
        <div className="mt-2 text-xs text-subtle">Tip: include a Twitter handle for richer citations.</div>
      )}
    </div>
  );
}

// Helper functions for salary formatting
const formatSalary = (value?: number | null) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0) return "$0";
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${Math.round(value / 1_000)}k`;
};

const formatSalaryRange = (low?: number | null, high?: number | null) => {
  const lowText = formatSalary(low);
  const highText = formatSalary(high);
  if (lowText && highText) {
    if (lowText === highText) return `${lowText}`;
    return `${lowText} – ${highText}`;
  }
  return lowText || highText || "Range unavailable";
};

// Career Tab Component
function CareerTabMain({ career, profile }: { career: any; profile: any }) {
  // Safely extract career data with fallbacks
  const careerData = career || { samples: [], segments: [] };
  const rawSamples: any[] = Array.isArray(careerData.samples) ? careerData.samples : [];
  const segments: any[] = Array.isArray(careerData.segments) ? careerData.segments : [];
  
  // Ensure samples have salary_low and salary_high for the chart
  const samples = rawSamples.map(sample => {
    const salary = sample.salary_usd || 0;
    return {
      ...sample,
      salary_low: sample.salary_low ?? salary * 0.9,
      salary_high: sample.salary_high ?? salary * 1.1,
    };
  });
  
  const sortedSamples = [...samples].sort((a, b) => (a.year || 0) - (b.year || 0));
  const hasSalaryData = sortedSamples.length > 0;

  return (
    <div className="space-y-6">
      <div className="bg-card rounded p-4">
        <div className="mb-4">
          <div className="text-sm text-subtle">Career compensation for {profile?.name || "this candidate"}</div>
          <div className="text-xs text-subtle">
            Median line with shaded low/high estimates (USD). Data sampled from Supabase and heuristic sources.
          </div>
        </div>
        {hasSalaryData ? (
          <CareerTrajectoryChart samples={sortedSamples} />
        ) : (
          <div className="text-center py-12 text-subtle">
            <div className="text-lg mb-2">No salary data available</div>
            <div className="text-sm">Compensation information has not been collected for this candidate yet.</div>
          </div>
        )}
      </div>

      {segments.length > 0 && (
        <div className="bg-card rounded p-4">
          <div className="mb-3 text-sm text-subtle">Tenure timeline</div>
          <ul className="space-y-3">
            {segments.map((segment: any, idx: number) => (
              <li key={`${segment.org || "org"}-${idx}`} className="border border-[#2a2a2d] rounded p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-accent font-medium">{segment.org || "Unknown organization"}</div>
                  <div className="text-xs text-subtle">
                    {segment.start_year ?? "—"} – {segment.end_year ?? "present"}
                  </div>
                </div>
                {segment.title && <div className="text-xs text-subtle mt-1">{segment.title}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasSalaryData && (
        <div className="bg-card rounded p-4">
          <div className="mb-3 text-sm text-subtle">Yearly breakdown</div>
          <div className="space-y-2 text-sm">
            {sortedSamples.map((sample: any, idx: number) => {
              const range = formatSalaryRange(sample.salary_low, sample.salary_high);
              const median = formatSalary(sample.salary_usd);
              return (
                <div
                  key={`${sample.year}-${sample.org}-${idx}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#2a2a2d] px-3 py-2"
                >
                  <div>
                    <div className="text-accent font-medium">
                      {sample.year ?? "Year N/A"} · {sample.org || "Unknown org"}
                    </div>
                    {sample.band && <div className="text-xs text-subtle">{sample.band}</div>}
                  </div>
                  <div className="text-right text-xs text-subtle">
                    <div className="text-sm text-white">{median ?? "— median"}</div>
                    <div>{range}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type ChartPoint = {
  year: number;
  org?: string;
  band?: string;
  median: number;
  low: number;
  high: number;
};

function CareerTrajectoryChart({ samples }: { samples: any[] }) {
  if (!samples || samples.length === 0) {
    return (
      <div className="text-center py-12 text-subtle">
        <div className="text-lg mb-2">No salary history</div>
        <div className="text-sm">We couldn't find any compensation records for this candidate.</div>
      </div>
    );
  }

  const points = samples
    .map((sample: any): ChartPoint | null => {
      const year = Number(sample.year);
      if (!Number.isFinite(year)) return null;
      const lowRaw = Number(sample.salary_low ?? sample.salary_usd ?? sample.salary_high ?? null);
      const highRaw = Number(sample.salary_high ?? sample.salary_usd ?? sample.salary_low ?? null);
      if (!Number.isFinite(lowRaw) && !Number.isFinite(highRaw)) return null;
      const low = Number.isFinite(lowRaw) ? lowRaw : highRaw;
      const high = Number.isFinite(highRaw) ? highRaw : lowRaw;
      const normalizedLow = Math.min(low ?? 0, high ?? 0);
      const normalizedHigh = Math.max(low ?? 0, high ?? 0);
      const medianSource = Number(
        sample.salary_usd ?? ((normalizedLow + normalizedHigh) / 2)
      );
      return {
        year,
        org: sample.org,
        band: sample.band,
        low: normalizedLow || 0,
        high: normalizedHigh || normalizedLow || 0,
        median: Number.isFinite(medianSource)
          ? medianSource
          : (normalizedLow + normalizedHigh) / 2,
      };
    })
    .filter((point): point is ChartPoint => Boolean(point))
    .sort((a, b) => a.year - b.year);

  if (points.length === 0) {
    return (
      <div className="text-center py-12 text-subtle">
        <div className="text-lg mb-2">No salary history</div>
        <div className="text-sm">We couldn't find any compensation records for this candidate.</div>
      </div>
    );
  }

  const minYear = Math.min(...points.map((p) => p.year));
  const maxYear = Math.max(...points.map((p) => p.year));
  const minSalary = Math.min(...points.map((p) => p.low));
  const maxSalary = Math.max(...points.map((p) => p.high));

  const width = 760;
  const height = 320;
  const padding = 36;

  const x = (year: number) => {
    if (!Number.isFinite(year) || maxYear === minYear) {
      return width / 2;
    }
    const result = padding + ((year - minYear) / (maxYear - minYear)) * (width - padding * 2);
    return Number.isFinite(result) ? result : width / 2;
  };

  const y = (value: number) => {
    if (!Number.isFinite(value) || maxSalary === minSalary) {
      return height / 2;
    }
    const result = height - padding - ((value - minSalary) / (maxSalary - minSalary)) * (height - padding * 2);
    return Number.isFinite(result) ? result : height / 2;
  };

  // Create step path for median line
  const medianPathParts: string[] = [];
  points.forEach((point, idx) => {
    if (idx === 0) {
      medianPathParts.push(`M ${x(point.year)} ${y(point.median)}`);
    } else {
      const prevPoint = points[idx - 1];
      medianPathParts.push(`H ${x(point.year)}`); // Horizontal to next x
      medianPathParts.push(`V ${y(point.median)}`); // Vertical to next y
    }
  });
  const medianPath = medianPathParts.join(" ");

  // Create step path for area fill
  const upperPathParts: string[] = [];
  points.forEach((point, idx) => {
    if (idx === 0) {
      upperPathParts.push(`M ${x(point.year)} ${y(point.high)}`);
    } else {
      upperPathParts.push(`H ${x(point.year)}`);
      upperPathParts.push(`V ${y(point.high)}`);
    }
  });
  
  const lowerPathParts: string[] = [];
  [...points].reverse().forEach((point) => {
    lowerPathParts.push(`H ${x(point.year)}`);
    lowerPathParts.push(`V ${y(point.low)}`);
  });
  
  const areaPath = `${upperPathParts.join(" ")} ${lowerPathParts.join(" ")} Z`;

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks }, (_, idx) => {
    const ratioDenominator = Math.max(1, yTicks - 1);
    const ratio = idx / ratioDenominator;
    return minSalary + (maxSalary - minSalary) * ratio;
  });

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Career compensation chart"
      >
        <defs>
          <linearGradient id="careerRangeGradientMain" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
          </linearGradient>
        </defs>

        {tickValues.map((tick) => (
          <g key={`grid-${tick}`}>
            <line
              x1={padding}
              x2={width - padding}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#262629"
              strokeDasharray="4 6"
            />
            <text
              x={padding - 8}
              y={y(tick) + 4}
              fontSize="11"
              fill="#9b9ba1"
              textAnchor="end"
            >
              {formatSalary(tick) || "$0"}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#careerRangeGradientMain)" stroke="none" />

        <path
          d={medianPath}
          fill="none"
          stroke="#f7f7f8"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {points.map((point) => (
          <g key={`pt-${point.year}`} transform={`translate(${x(point.year)}, ${y(point.median)})`}>
            <circle r={4} fill="#f7f7f8" />
            <text y={-10} textAnchor="middle" fontSize="10" fill="#c2c2c7">
              {point.year}
            </text>
          </g>
        ))}

        <line
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
          stroke="#2a2a2d"
        />
        {[minYear, maxYear].map((year, idx) => (
          <text
            key={`year-${year}-${idx}`}
            x={idx === 0 ? padding : width - padding}
            y={height - padding + 24}
            fontSize="11"
            fill="#9b9ba1"
            textAnchor={idx === 0 ? "start" : "end"}
          >
            {year}
          </text>
        ))}
      </svg>
    </div>
  );
}
