# X AI Talent Engineer

A full-stack application for discovering and analyzing AI researchers through an interactive network graph visualization and intelligent search capabilities.

## Features

### Interactive Network Graph
- Visual network map of Twitter relationships
- Profile pictures loaded on nodes
- Click to highlight connections - selected node's links become bold and bright
- Drag, pan, and zoom to explore the network
- Color-coded relationships: Green (mutual follows), Blue (following), Purple (followers)

### Researcher Discovery
- Browse curated lists of AI researchers
- Search and filter by username
- View detailed profiles with LinkedIn integration
- Career trajectory analysis with salary estimates
- Publication history and citations

### AI-Powered Chat
- Chat with researcher profiles using their Twitter data
- RAG powered responses based on actual tweets and career info

## Tech Stack

### Backend
- FastAPI
- Supabase (PostgreSQL)
- OpenAI / Grok

### Frontend
- Next.js 14
- TypeScript
- TailwindCSS
- react-force-graph-2d
- d3-force

## Project Structure

```
.
├── api/                   # Backend FastAPI application
│   ├── app/              # Application code
│   │   ├── main.py      # API routes
│   │   ├── models.py    # Database models
│   │   ├── rag.py       # RAG implementation
│   │   └── ...
│   └── requirements.txt
│
└── web/                  # Frontend Next.js application
    ├── app/
    │   ├── page.tsx     # Main dashboard
    │   └── network/     # Network graph page
    ├── components/      # React components
    └── package.json
```

## Database Schema

### twitter_relationships
Network connections between users.

### twitter_user_corpus
User profiles and aggregated Twitter data.

### researchers
Curated list of AI researchers.

## Network Graph

### Controls
- Pan: Click and drag
- Zoom: Scroll wheel
- Search: Find and zoom to users
- Click: Select node and highlight connections
- Drag: Reposition individual nodes

### Visual Design
- Uniform node size with profile pictures
- Color-coded relationship types
- Bold/thick links for selected node connections
- Grid-based initialization for clean layout
