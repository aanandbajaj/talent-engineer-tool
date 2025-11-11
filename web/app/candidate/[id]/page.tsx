"use client";

import useSWR from "swr";
import { useEffect, useRef, useState } from "react";
import ChatPanel from "../../../components/chat/ChatPanel";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  (typeof window !== "undefined" ? `${window.location.origin}/api/mock` : "http://localhost:3000/api/mock");

const fetcher = (u: string) => fetch(u).then((r) => r.json());

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

type TabKey = "profile" | "career" | "chat";

export default function CandidatePage({ params }: { params: { id: string } }) {
  const { data, error, isLoading } = useSWR(
    `${API_BASE}/candidate/${params.id}`,
    fetcher
  );
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const contentRef = useRef<HTMLDivElement>(null);

  const handleTabChange = (tabId: TabKey) => {
    setActiveTab(tabId);
  };

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
        <div className="text-subtle text-sm">Loading profile...</div>
      </div>
    </div>
  );
  if (error) return <div className="text-red-400">Error loading candidate</div>;

  const profile = data?.profile || {};
  const career = data?.career || { segments: [], samples: [] };
  const papers = data?.papers || [];

  const tabs: { id: TabKey; label: string; helper?: string }[] = [
    { id: "profile", label: "Profile", helper: "Bio, publications, work history" },
    { id: "career", label: "Career", helper: "Comp & roles timeline" },
    { id: "chat", label: "Chat", helper: "Grok via OpenRouter" },
  ];

  return (
    <main>
      <div className="mb-6">
        <div className="text-2xl font-semibold tracking-tight">{profile?.name}</div>
        {profile?.affiliation && (
          <div className="text-sm text-subtle">{profile.affiliation}</div>
        )}
      </div>

      <div className="mb-6 border-b border-[#2a2a2d]">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`px-4 py-2 rounded-t font-medium flex items-center gap-2 transition-colors ${
                activeTab === tab.id
                  ? "bg-card text-white border border-[#2a2a2d] border-b-transparent"
                  : "text-subtle border border-transparent hover:text-white"
              }`}
            >
              <span>{tab.label}</span>
              {tab.id === "chat" && <img src="/grok.svg" alt="Grok" className="h-4 w-auto" />}
              {tab.helper && activeTab === tab.id && (
                <span className="text-xs text-subtle hidden sm:inline">{tab.helper}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div ref={contentRef} style={{ scrollMarginTop: 0 }}>
        {activeTab === "profile" && (
          <ProfileTab profile={profile} career={career} papers={papers} />
        )}
        {activeTab === "career" && (
          <CareerTab career={career} profile={profile} />
        )}
        {activeTab === "chat" && (
          <ChatTab candidateId={params.id} profile={profile} />
        )}
      </div>
    </main>
  );
}

function ProfileTab({ profile, career, papers }: { profile: any; career: any; papers: any[] }) {
  const workExperience = profile?.work_experience || [];
  const education = profile?.education || [];
  
  return (
    <div className="space-y-6">
      {/* Header with profile picture and basic info */}
      <div className="bg-card rounded p-4">
        <div className="flex gap-4">
          {profile?.profile_picture && (
            <img 
              src={profile.profile_picture} 
              alt={profile.name}
              className="w-24 h-24 rounded-full object-cover"
            />
          )}
          <div className="flex-1">
            <h2 className="text-2xl font-semibold text-white">{profile?.name}</h2>
            {profile?.headline && (
              <div className="text-base text-accent mt-1">{profile.headline}</div>
            )}
            {profile?.location && (
              <div className="text-sm text-subtle mt-2">{profile.location}</div>
            )}
            <div className="flex gap-4 mt-2 text-xs text-subtle">
              {profile?.connections_count && (
                <div>{profile.connections_count.toLocaleString()} connections</div>
              )}
              {profile?.follower_count && (
                <div>{profile.follower_count.toLocaleString()} followers</div>
              )}
            </div>
          </div>
        </div>
        
        {profile?.summary && (
          <div className="mt-4 pt-4 border-t border-[#2a2a2d]">
            <div className="text-xs uppercase text-subtle tracking-wide mb-2">About</div>
            <div className="text-sm text-white whitespace-pre-wrap">{profile.summary}</div>
          </div>
        )}
        
        <div className="flex flex-wrap gap-2 mt-4 text-sm">
          {profile?.scholar_url && (
            <a
              href={profile.scholar_url}
              target="_blank"
              rel="noreferrer noopener"
              className="px-3 py-1 rounded-full border border-[#2a2a2d] hover:border-accent"
            >
              Scholar ↗
            </a>
          )}
          {profile?.linkedin_url && (
            <a
              href={profile.linkedin_url}
              target="_blank"
              rel="noreferrer noopener"
              className="px-3 py-1 rounded-full border border-[#2a2a2d] hover:border-accent"
            >
              LinkedIn ↗
            </a>
          )}
          {profile?.openalex_url && (
            <a
              href={profile.openalex_url}
              target="_blank"
              rel="noreferrer noopener"
              className="px-3 py-1 rounded-full border border-[#2a2a2d] hover:border-accent"
            >
              OpenAlex ↗
            </a>
          )}
          {profile?.twitter_handle && (
            <span className="px-3 py-1 rounded-full border border-[#2a2a2d] text-subtle">
              {profile.twitter_handle.startsWith("@") ? profile.twitter_handle : `@${profile.twitter_handle}`}
            </span>
          )}
        </div>
      </div>
      
      {/* Work Experience */}
      {workExperience.length > 0 && (
        <div className="bg-card rounded p-4">
          <div className="text-xs uppercase text-subtle tracking-wide mb-3">Experience</div>
          <div className="space-y-4">
            {workExperience.map((work: any, idx: number) => {
              // Format dates: "2016-01" -> "Jan 2016", "present" stays as "Present"
              const formatDate = (dateStr: string | null) => {
                if (!dateStr) return null;
                if (dateStr.toLowerCase() === 'present') return 'Present';
                
                // Parse "YYYY-MM" format
                const match = dateStr.match(/^(\d{4})-(\d{2})$/);
                if (match) {
                  const [, year, month] = match;
                  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  const monthIdx = parseInt(month, 10) - 1;
                  return `${monthNames[monthIdx]} ${year}`;
                }
                
                // If it's just a year or other format, return as-is
                return dateStr;
              };
              
              const startFormatted = formatDate(work.start);
              const endFormatted = formatDate(work.end);
              const dateRange = startFormatted && endFormatted 
                ? `${startFormatted} - ${endFormatted}` 
                : startFormatted || endFormatted || 'n/a';
              
              return (
                <div key={idx} className="flex gap-4">
                  <div className="w-2 flex-shrink-0 bg-accent rounded-full" />
                  <div className="flex-1 pb-4">
                    <div className="font-semibold text-white text-base">{work.position}</div>
                    <div className="text-accent mt-1">{work.company}</div>
                    <div className="text-xs text-subtle mt-1">{dateRange}</div>
                    {work.location && (
                      <div className="text-xs text-subtle mt-1">📍 {work.location}</div>
                    )}
                    {work.description && (
                      <div className="text-sm text-white mt-3 leading-relaxed">{work.description}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Education */}
      {education.length > 0 && (
        <div className="bg-card rounded p-4">
          <div className="text-xs uppercase text-subtle tracking-wide mb-3">Education</div>
          <div className="space-y-4">
            {education.map((edu: any, idx: number) => (
              <div key={idx} className="flex gap-4">
                <div className="w-2 flex-shrink-0 bg-accent rounded-full" />
                <div className="flex-1 pb-4">
                  <div className="font-semibold text-white text-base">{edu.school}</div>
                  <div className="text-accent mt-1">{edu.degree}</div>
                  {edu.activities && (
                    <div className="text-xs text-subtle mt-2">{edu.activities}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card rounded p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-subtle">Top papers</div>
          {profile?.openalex_url && (
            <a
              href={profile.openalex_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-subtle hover:text-accent"
            >
              OpenAlex profile ↗
            </a>
          )}
        </div>
        <ul className="space-y-2">
          {papers.map((p: any, i: number) => (
            <li key={i} className="flex items-start justify-between gap-4">
              <div>
                {p.openalex_url ? (
                  <a
                    href={p.openalex_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-medium hover:text-accent"
                  >
                    {p.title}
                  </a>
                ) : (
                  <div className="font-medium">{p.title}</div>
                )}
                <div className="text-sm text-subtle">
                  {p.venue || ""} {p.year ? `· ${p.year}` : ""}
                </div>
              </div>
              <div className="text-right text-sm text-subtle">{p.citations} cites</div>
            </li>
          ))}
          {papers.length === 0 && (
            <li className="text-sm text-subtle">No publications recorded yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function CareerTab({ career, profile }: { career: any; profile: any }) {
  const samples: any[] = Array.isArray(career?.samples) ? career.samples : [];
  const segments: any[] = Array.isArray(career?.segments) ? career.segments : [];
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

function ChatTab({ candidateId, profile }: { candidateId: string; profile: any }) {
  const hasTweets = profile?.has_tweets || false;
  
  return (
    <div className="space-y-6">
      <div className="bg-card rounded p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-sm text-subtle">
              Chat with Grok about {profile?.name}'s interests
              {hasTweets && <span className="ml-2 text-green-500">✓ Tweets available</span>}
              {!hasTweets && <span className="ml-2 text-yellow-500">⚠️ No tweets</span>}
            </div>
            <div className="text-xs text-subtle">Powered by x-ai/grok-4-fast via the OpenRouter Responses API Beta.</div>
          </div>
          <div className="flex items-center gap-2">
            <img src="/grok.svg" alt="Grok" width={72} height={18} />
            <a
              href="https://openrouter.ai/docs/api-reference/responses/overview"
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-accent"
            >
              OpenRouter ↗
            </a>
          </div>
        </div>
        <ChatPanel 
          apiBase={API_BASE} 
          candidateId={candidateId} 
          handle={profile?.twitter_handle}
          hasTweets={hasTweets}
        />
      </div>
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
        <div className="text-sm">We couldn’t find any compensation records for this candidate.</div>
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
    if (maxYear === minYear) {
      return width / 2;
    }
    return padding + ((year - minYear) / (maxYear - minYear)) * (width - padding * 2);
  };

  const y = (value: number) => {
    if (maxSalary === minSalary) {
      return height / 2;
    }
    return (
      height -
      padding -
      ((value - minSalary) / (maxSalary - minSalary)) * (height - padding * 2)
    );
  };

  const buildStepCoords = (accessor: (p: ChartPoint) => number) => {
    if (!points.length) return [];
    const coords: Array<{ x: number; y: number }> = [
      { x: x(points[0].year), y: y(accessor(points[0])) },
    ];
    for (let i = 1; i < points.length; i += 1) {
      const currX = x(points[i].year);
      const prevY = coords[coords.length - 1]?.y ?? y(accessor(points[i - 1]));
      const currY = y(accessor(points[i]));
      coords.push({ x: currX, y: prevY });
      coords.push({ x: currX, y: currY });
    }
    return coords;
  };

  const coordsToPath = (
    coords: Array<{ x: number; y: number }>,
    { skipMove = false }: { skipMove?: boolean } = {}
  ) =>
    coords
      .map((pt, idx) => {
        const cmd = idx === 0 && !skipMove ? "M" : "L";
        return `${cmd} ${pt.x} ${pt.y}`;
      })
      .join(" ");

  const medianStepCoords = buildStepCoords((p) => p.median);
  const highStepCoords = buildStepCoords((p) => p.high);
  const lowStepCoords = buildStepCoords((p) => p.low);

  const medianStepPath = coordsToPath(medianStepCoords);
  const areaPath = `${coordsToPath(highStepCoords)} ${coordsToPath(
    lowStepCoords.slice().reverse(),
    { skipMove: true }
  )} Z`;

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
          <linearGradient id="careerRangeGradient" x1="0" y1="0" x2="0" y2="1">
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

        {areaPath && (
          <path d={areaPath} fill="url(#careerRangeGradient)" stroke="none" />
        )}

        {medianStepPath && (
          <path
            d={medianStepPath}
            fill="none"
            stroke="#f7f7f8"
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}

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
