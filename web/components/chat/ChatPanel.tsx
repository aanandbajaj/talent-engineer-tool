"use client";

import { useEffect, useRef, useState } from "react";

type Citation = { post_id: string; url?: string };
type ChatMsg = { role: "user" | "assistant"; content: string; citations?: Citation[]; error?: boolean };

export default function ChatPanel({
  apiBase,
  candidateId,
  handle,
  hasTweets = false,
  modelLabel = "x‑ai/grok‑4‑fast",
}: {
  apiBase: string;
  candidateId: string;
  handle?: string;
  hasTweets?: boolean;
  modelLabel?: string;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Only scroll the chat container itself, not the page
    // Only run if we actually have messages
    if (scrollRef.current && msgs.length > 0) {
      const container = scrollRef.current;
      // Don't trigger scroll on initial mount, only when messages change
      requestAnimationFrame(() => {
        if (container && container.scrollHeight > container.clientHeight) {
          // Use scrollTop directly to avoid triggering page scroll
          container.scrollTop = container.scrollHeight;
        }
      });
    }
  }, [msgs]);

  const send = async () => {
    const q = value.trim();
    if (!q) return;
    
    // Prevent default form submission behavior
    event?.preventDefault();
    
    setValue("");
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/candidate/${candidateId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({ detail: "Unknown error" }));
        const errorMsg = errorData.detail || "Chat failed";
        setMsgs((m) => [...m, { role: "assistant", content: errorMsg, error: true }]);
        setLoading(false);
        return;
      }
      
      const data = await r.json();
      const citations = (data?.citations || []) as Citation[];
      const answer = (data?.answer || "(no answer)") as string;
      setMsgs((m) => [...m, { role: "assistant", content: answer, citations }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `Error: ${e?.message || e}`, error: true }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full overflow-hidden rounded border border-[#2a2a2d] bg-card">
      <div className="flex items-center justify-between border-b border-[#2a2a2d] px-3 py-2">
        <div className="text-sm text-subtle">Chat</div>
        <div className="text-xs text-subtle rounded bg-[#1f1f22] px-2 py-0.5">{modelLabel}</div>
      </div>

      <div ref={scrollRef} className="min-h-[22rem] h-[32rem] sm:h-[36rem] overflow-y-auto px-3 py-3 bg-[#111113]">
        {msgs.length === 0 && !hasTweets && (
          <div className="text-sm text-yellow-500 bg-yellow-500/10 rounded p-3">
            ⚠️ No tweet data available. Please ingest tweets via the backend before chatting.
          </div>
        )}
        {msgs.length === 0 && hasTweets && (
          <div className="text-sm text-subtle">Ask about topics they discuss on X. Answers will be grounded in retrieved tweets.</div>
        )}
        <div className="space-y-3">
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-auto max-w-[92%] text-accent" : `mr-auto max-w-[92%] ${m.error ? 'text-red-400' : 'text-subtle'}`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.role === "assistant" && !!m.citations?.length && (
                <div className="mt-2 text-xs text-subtle">
                  Sources:{" "}
                  {m.citations.map((c, j) => (
                    <a
                      key={`${c.post_id}-${j}`}
                      href={c.url || `https://x.com/i/web/status/${c.post_id}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline hover:text-accent mr-2"
                    >
                      [{j + 1}]
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-subtle">
              <div className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              Grok is thinking…
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[#2a2a2d] p-2">
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            if (!loading && hasTweets && value.trim()) {
              send();
            }
          }}
          className="flex items-center gap-2"
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!loading && hasTweets && value.trim()) {
                  send();
                }
              }
            }}
            onFocus={(e) => {
              // Prevent scroll when input is focused
              e.preventDefault();
              e.target.scrollIntoView = () => {};
            }}
            autoFocus={false}
            className="flex-1 rounded border border-[#2a2a2d] bg-[#0b0b0f] px-3 py-2 text-sm text-accent outline-none focus:border-accent disabled:opacity-50"
            placeholder={hasTweets ? "Type a question…" : "Tweet data required to enable chat"}
            disabled={!hasTweets}
          />
          <button
            type="submit"
            disabled={loading || !value.trim() || !hasTweets}
            className="rounded bg-accent px-3 py-2 text-sm text-black transition hover:bg-accent/90 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>

      {!hasTweets && (
        <div className="px-3 pb-3 text-xs text-yellow-500">⚠️ Chat disabled: tweet data not ingested yet. Ask an operator to import recent tweets.</div>
      )}
      {hasTweets && !handle && (
        <div className="px-3 pb-3 text-xs text-subtle">Tip: set a Twitter handle for better citations.</div>
      )}
    </div>
  );
}
