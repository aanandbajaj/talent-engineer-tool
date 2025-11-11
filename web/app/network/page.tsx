"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { forceCollide, forceManyBody } from "d3-force";
import Image from "next/image";
import logo from "../../assets/logo_black.png";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
const API_BASE = RAW_API_BASE && RAW_API_BASE.startsWith("http")
  ? "/api/backend"
  : RAW_API_BASE || (typeof window !== "undefined" ? `${window.location.origin}/api/mock` : "http://localhost:3000/api/mock");

type Relationship = {
  id: number;
  source_username: string;
  target_username: string;
  following: boolean;
  followed_by: boolean;
  checked_at: string;
};

type NetworkStats = {
  total_relationships: number;
  unique_users: number;
  mutual_follows: number;
  one_way_following: number;
  one_way_followers: number;
};

type GraphNode = {
  id: string;
  name: string;
  val: number;
  img?: HTMLImageElement;
  photoUrl?: string;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

type GraphLink = {
  source: string;
  target: string;
  type: "mutual" | "following" | "follower";
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

type UserProfile = {
  username: string;
  name: string | null;
  linkedin_profile_2?: {
    profile_picture_url?: string;
  };
};

export default function NetworkPage() {
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoProgress, setPhotoProgress] = useState({ loaded: 0, total: 0 });
  const graphRef = useRef<any>();
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    fetchRelationships();
    fetchStats();
  }, []);

  // Reconfigure forces whenever data or spread changes
  useEffect(() => {
    if (!graphRef.current || graphData.nodes.length === 0) return;

    const fg = graphRef.current;

    // VERY STRONG repulsion to spread nodes far apart
    const charge = forceManyBody()
      .strength(-8000)
      .distanceMax(4000);
    fg.d3Force("charge", charge);

    // Strong collision detection - HUGE padding, absolutely no overlap
    const collide = forceCollide((n: any) => {
      const nodeRadius = 24 + 80; // Fixed node size (3x bigger) + massive padding
      return nodeRadius;
    })
      .strength(1.5)
      .iterations(6);
    fg.d3Force("collide", collide);

    // VERY long link distances for maximum separation
    const link = fg.d3Force("link");
    if (link && typeof link.distance === "function") {
      (link as any).distance(500); // Extremely long links
      (link as any).strength(0.3); // Weaker links so nodes spread more
    }

    // Weak center force to keep graph loosely together
    const center = fg.d3Force("center");
    if (center && typeof center.strength === "function") {
      center.strength(0.02);
    }

    // Very slow cooling for full expansion
    fg.d3AlphaDecay(0.005);
    fg.d3VelocityDecay(0.2);
    
    // Restart simulation
    fg.d3ReheatSimulation();
  }, [graphData]);

  const fetchRelationships = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/relationships?limit=2000`);
      if (!res.ok) throw new Error(`Failed to fetch relationships: ${res.statusText}`);
      const data = await res.json();
      buildGraphData(data.relationships || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load relationships");
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/relationships/network/stats`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("Failed to load stats:", err);
    } finally {
      setStatsLoading(false);
    }
  };

  const buildGraphData = async (relationships: Relationship[]) => {
    const nodeMap = new Map<string, { connections: number }>();
    const links: GraphLink[] = [];

    relationships.forEach((rel) => {
      const source = rel.source_username;
      const target = rel.target_username;

      if (!nodeMap.has(source)) nodeMap.set(source, { connections: 0 });
      if (!nodeMap.has(target)) nodeMap.set(target, { connections: 0 });

      nodeMap.get(source)!.connections++;
      nodeMap.get(target)!.connections++;

      let type: "mutual" | "following" | "follower" = "following";
      if (rel.following && rel.followed_by) type = "mutual";
      else if (rel.followed_by) type = "follower";

      links.push({ source, target, type });
    });

    const nodes: GraphNode[] = Array.from(nodeMap.entries()).map(([id, data], index) => {
      // Pre-position nodes in a HUGE grid to avoid any overlap
      const total = nodeMap.size;
      const cols = Math.ceil(Math.sqrt(total));
      const rows = Math.ceil(total / cols);
      const spacing = 200; // Large spacing between nodes
      const row = Math.floor(index / cols);
      const col = index % cols;
      
      // Center the grid
      const x = (col - cols / 2) * spacing;
      const y = (row - rows / 2) * spacing;
      
      return {
        id,
        name: id,
        val: 24, // Fixed size for all nodes (3x bigger)
        x,
        y,
        fx: x, // Fix initial position
        fy: y, // Fix initial position
      };
    });

    setGraphData({ nodes, links });
    
    // Unfix positions after a short delay so physics can take over
    setTimeout(() => {
      if (graphRef.current) {
        graphRef.current.graphData().nodes.forEach((node: any) => {
          delete node.fx;
          delete node.fy;
        });
      }
    }, 100);
    
    // Load photos in background
    loadNodePhotos(nodes);

    // Seed initial positions in a wide radial layout to avoid clumping at origin
    // This gives the physics engine a head start on a spread-out configuration
    setTimeout(() => {
      const R = Math.max(600, nodes.length * 18);
      nodes.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / nodes.length;
        // jitter so we don't get perfect ring artifacts
        const jitter = 0.85 + Math.random() * 0.5;
        // Assign initial x/y directly (ForceGraph reads these as starting positions)
        // @ts-ignore - x/y are accepted by react-force-graph nodes
        n.x = Math.cos(angle) * R * jitter;
        // @ts-ignore
        n.y = Math.sin(angle) * R * jitter;
      });
      setGraphData((prev) => ({ ...prev, nodes: [...nodes] }));
      // if available, reheat the engine so new seeds take effect
      try {
        graphRef.current?.d3ReheatSimulation?.();
        graphRef.current?.zoomToFit?.(800, 60);
      } catch {}
    }, 0);
  };

  const loadNodePhotos = async (nodes: GraphNode[]) => {
    setLoadingPhotos(true);
    setPhotoProgress({ loaded: 0, total: nodes.length });

    try {
      // Batch API call - get all profiles in 1-2 requests
      const batchSize = 500;
      const allProfiles: UserProfile[] = [];
      
      for (let i = 0; i < nodes.length; i += batchSize) {
        const batch = nodes.slice(i, i + batchSize);
        const usernames = batch.map((n) => n.id);
        
        const res = await fetch(`${API_BASE}/relationships/profiles/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usernames }),
        });
        
        if (res.ok) {
          const data = await res.json();
          allProfiles.push(...(data.profiles || []));
        }
      }

      // Create profile lookup map
      const profileMap = new Map<string, UserProfile>();
      allProfiles.forEach((p) => profileMap.set(p.username, p));

      // Load all images concurrently
      let loaded = 0;
      let successCount = 0;
      
      await Promise.all(
        nodes.map(async (node) => {
          try {
            const profile = profileMap.get(node.id);
            const photoUrl = profile?.linkedin_profile_2?.profile_picture_url;
            
            if (photoUrl) {
              const img = await loadImage(photoUrl);
              if (img) {
                imageCache.current.set(node.id, img);
                node.img = img;
                node.photoUrl = photoUrl;
                successCount++;
              }
            }
          } catch (err) {
            // Silently fail for individual photos
          } finally {
            loaded++;
            setPhotoProgress({ loaded, total: nodes.length });
          }
        })
      );
      
      console.log(`Loaded ${successCount} profile photos out of ${nodes.length} nodes`);

      // Update graph with all loaded images
      setGraphData((prev) => ({ ...prev, nodes: [...prev.nodes] }));
    } catch (err) {
      console.error("Failed to load photos:", err);
    } finally {
      setLoadingPhotos(false);
    }
  };

  const loadImage = (url: string): Promise<HTMLImageElement | null> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      // Try without crossOrigin first for LinkedIn images
      img.onload = () => resolve(img);
      img.onerror = () => {
        // If failed, try with crossOrigin
        const img2 = new window.Image();
        img2.crossOrigin = "anonymous";
        img2.onload = () => resolve(img2);
        img2.onerror = () => resolve(null);
        img2.src = url;
      };
      img.src = url;
    });
  };

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node);
    setSearchTerm(node.id);
  }, []);

  const handleSearch = useCallback(() => {
    if (!searchTerm || !graphRef.current) return;
    
    const node = graphData.nodes.find((n) => 
      n.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    if (node) {
      graphRef.current.centerAt(node.x, node.y, 1000);
      graphRef.current.zoom(3, 1000);
      setSelectedNode(node);
    }
  }, [searchTerm, graphData.nodes]);

  const getNodeColor = (node: any) => {
    if (selectedNode && node.id === selectedNode.id) return "#e9e9ea"; // accent color
    if (searchTerm && node.id.toLowerCase().includes(searchTerm.toLowerCase())) {
      return "#60a5fa";
    }
    return "#6b7280";
  };

  const getLinkColor = (link: any) => {
    // Highlight links connected to selected node
    if (selectedNode) {
      const isConnected = 
        (typeof link.source === "object" ? link.source.id : link.source) === selectedNode.id ||
        (typeof link.target === "object" ? link.target.id : link.target) === selectedNode.id;
      
      if (isConnected) {
        if (link.type === "mutual") return "rgba(16, 185, 129, 1)"; // bright green
        if (link.type === "following") return "rgba(59, 130, 246, 1)"; // bright blue
        return "rgba(167, 139, 250, 1)"; // bright purple
      }
    }
    
    // Default colors
    if (link.type === "mutual") return "rgba(16, 185, 129, 0.4)"; // green with transparency
    if (link.type === "following") return "rgba(59, 130, 246, 0.3)"; // blue with transparency
    return "rgba(167, 139, 250, 0.3)"; // purple with transparency
  };

  const getLinkWidth = (link: any) => {
    // Make links thicker when connected to selected node
    if (selectedNode) {
      const isConnected = 
        (typeof link.source === "object" ? link.source.id : link.source) === selectedNode.id ||
        (typeof link.target === "object" ? link.target.id : link.target) === selectedNode.id;
      
      if (isConnected) return 3; // Bold/thick
    }
    return 0.8; // Default thin
  };

  return (
    <div className="min-h-screen bg-bg text-accent flex flex-col">
      {/* Header */}
      <header className="border-b border-[#1f1f22] bg-[#111113] z-10">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Image src={logo} alt="Logo" width={40} height={40} className="h-10 w-10 rounded-sm" priority />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Network Graph</h1>
              {statsLoading ? (
                <div className="text-xs text-subtle">Loading stats...</div>
              ) : stats ? (
                <div className="text-xs text-subtle">
                  {stats.unique_users} users · {stats.total_relationships} connections
                  {loadingPhotos && ` · ${photoProgress.loaded}/${photoProgress.total} photos`}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search username..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="px-3 py-2 bg-[#0b0b0f] border border-[#1f1f22] rounded-md text-sm focus:outline-none focus:border-accent w-48"
              />
              <button
                onClick={handleSearch}
                className="px-4 py-2 bg-accent text-black rounded-md text-sm font-medium transition hover:bg-accent/90"
              >
                Find
              </button>
            </div>
            <a
              href="/"
              className="px-4 py-2 rounded-md border border-[#2a2a2d] bg-[#1f1f22] text-sm font-medium transition hover:bg-[#2a2a2d]"
            >
              Home
            </a>
          </div>
        </div>
      </header>

      {/* Main Content - Graph Canvas */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Loading State - Initial + Photos */}
        {(loading || loadingPhotos) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg z-50">
            <div className="w-16 h-16 border-4 border-accent border-t-transparent rounded-full animate-spin" />
            {loading ? (
              <>
                <p className="text-accent text-lg mt-6 font-semibold">Loading network...</p>
                <p className="text-subtle text-sm mt-2">Building graph with {statsLoading ? '...' : stats?.unique_users || 0} nodes</p>
              </>
            ) : (
              <>
                <p className="text-accent text-lg mt-6 font-semibold">Loading profile photos...</p>
                <p className="text-subtle text-sm mt-2">
                  {photoProgress.loaded} / {photoProgress.total} loaded
                </p>
                <div className="w-64 h-2 bg-[#1f1f22] rounded-full mt-4 overflow-hidden">
                  <div 
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${(photoProgress.loaded / photoProgress.total) * 100}%` }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg z-50">
            <div className="bg-red-500/10 border border-red-500 rounded-lg p-8 max-w-md">
              <h3 className="text-xl font-bold text-red-400 mb-4">Failed to Load Network</h3>
              <p className="text-red-300 mb-6">{error}</p>
              <button
                onClick={fetchRelationships}
                className="w-full px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-md transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Graph Canvas */}
        {!loading && !loadingPhotos && !error && (
          <>
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              nodeLabel="id"
              nodeVal="val"
              nodeColor={getNodeColor}
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const label = node.id;
                const fontSize = 12 / globalScale;
                const radius = node.val;

                // Draw node with image or colored circle
                if (node.img) {
                  // Draw circular clipped image
                  ctx.save();
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                  ctx.clip();
                  ctx.drawImage(node.img, node.x - radius, node.y - radius, radius * 2, radius * 2);
                  ctx.restore();

                  // Draw border
                  ctx.strokeStyle = getNodeColor(node);
                  ctx.lineWidth = 2 / globalScale;
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                  ctx.stroke();
                } else {
                  // Draw colored circle (fallback)
                  ctx.fillStyle = getNodeColor(node);
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                  ctx.fill();
                }

                // Draw label when zoomed in
                if (globalScale > 1.5) {
                  ctx.font = `${fontSize}px Sans-Serif`;
                  const textWidth = ctx.measureText(label).width;
                  const bckgDimensions = [textWidth, fontSize].map((n) => n + fontSize * 0.4);

                  ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
                  ctx.fillRect(
                    node.x - bckgDimensions[0] / 2,
                    node.y + radius + 2,
                    bckgDimensions[0],
                    bckgDimensions[1]
                  );

                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillStyle = "#e9e9ea";
                  ctx.fillText(label, node.x, node.y + radius + 2 + bckgDimensions[1] / 2);
                }
              }}
              linkColor={getLinkColor}
              linkWidth={getLinkWidth}
              // distance is set via d3Force('link') in useEffect
              linkDirectionalParticles={2}
              linkDirectionalParticleWidth={1.5}
              linkDirectionalParticleSpeed={0.003}
              onNodeClick={handleNodeClick}
              backgroundColor="#0b0b0f"
              warmupTicks={0}
              cooldownTicks={200}
              cooldownTime={15000}
              enableNodeDrag={true}
              enableZoomInteraction={true}
              enablePanInteraction={true}
            />
            
            {/* Side Panel */}
            {selectedNode && (
              <div className="absolute right-0 top-0 bottom-0 w-80 bg-[#111113] border-l border-[#1f1f22] p-6 overflow-y-auto">
                <div className="flex items-start justify-between mb-6">
                  <h3 className="text-lg font-semibold">Node Details</h3>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="text-subtle hover:text-accent text-xl"
                  >
                    ×
                  </button>
                </div>
                
                <div className="space-y-4">
                  {selectedNode.photoUrl && (
                    <div className="flex justify-center mb-4">
                      <img 
                        src={selectedNode.photoUrl} 
                        alt={selectedNode.id}
                        className="w-24 h-24 rounded-full border-2 border-accent"
                      />
                    </div>
                  )}
                  
                  <div>
                    <div className="text-sm text-subtle mb-1">Username</div>
                    <div className="text-lg font-medium text-accent">@{selectedNode.id}</div>
                  </div>
                  
                  <div>
                    <div className="text-sm text-subtle mb-1">Connections</div>
                    <div className="text-2xl font-bold text-accent">
                      {Math.round(selectedNode.val * 2)}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-[#1f1f22]">
                    <a
                      href={`https://twitter.com/${selectedNode.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full px-4 py-2 bg-accent text-black rounded-md text-center font-medium transition hover:bg-accent/90"
                    >
                      View on X →
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="absolute bottom-6 left-6 bg-[#111113] border border-[#1f1f22] rounded-lg p-4">
              <div className="text-sm font-semibold mb-3 text-accent">Legend</div>
              <div className="space-y-2 text-xs text-subtle">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-0.5 bg-green-500"></div>
                  <span>Mutual follows</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-0.5 bg-blue-500"></div>
                  <span>Following</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-0.5 bg-purple-500"></div>
                  <span>Follower</span>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <div className="w-3 h-3 rounded-full bg-accent"></div>
                  <span>Selected node</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-400"></div>
                  <span>Search result</span>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-[#1f1f22] text-xs text-subtle">
                <div>• Drag to pan</div>
                <div>• Scroll to zoom</div>
                <div>• Click nodes for details</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
