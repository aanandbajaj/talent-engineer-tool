# X AI Talent Engineer

A full-stack application for discovering and analyzing AI researchers through an interactive network graph visualization and intelligent search capabilities.

## 🌟 Features

### 🕸️ Interactive Network Graph
- **Visual network map** of Twitter relationships from researchers
- **Profile pictures** loaded on nodes with batch optimization
- **Click to highlight** - connections become bold and bright when you select a node
- **Drag, pan, and zoom** to explore the network
- **Color-coded relationships**:
  - 🟢 Green = Mutual follows
  - 🔵 Blue = Following
  - 🟣 Purple = Followers

### 🔍 Researcher Search & Discovery
- Browse curated lists of AI researchers
- Search and filter by username
- View detailed profiles with LinkedIn integration
- Career trajectory analysis with salary estimates
- Publication history and citations

### 💬 AI-Powered Chat
- Chat with researcher profiles using their Twitter data
- RAG (Retrieval Augmented Generation) powered responses
- Context-aware answers based on actual tweets and career info

## 🛠️ Tech Stack

### Backend
- **FastAPI** - High-performance Python API framework
- **Supabase** - PostgreSQL database with real-time capabilities
- **OpenAI / Grok** - LLM integrations for chat
- **Twitter API** - Social data ingestion
- **LinkedIn scraping** - Profile enrichment

### Frontend
- **Next.js 14** - React framework with App Router
- **TypeScript** - Type-safe development
- **TailwindCSS** - Utility-first styling
- **react-force-graph-2d** - Network graph visualization
- **d3-force** - Physics simulation for graph layout
- **SWR** - Data fetching and caching

## 📁 Project Structure

```
.
├── api/                    # Backend FastAPI application
│   ├── app/
│   │   ├── main.py        # API routes and endpoints
│   │   ├── models.py      # SQLAlchemy models
│   │   ├── schemas.py     # Pydantic schemas
│   │   ├── db.py          # Database connection
│   │   ├── rag.py         # RAG implementation
│   │   ├── embeddings.py  # Vector embeddings
│   │   ├── supabase_repo.py   # Supabase queries
│   │   ├── supabase_client.py # Supabase connection
│   │   ├── connectors/    # External API clients
│   │   └── ...
│   ├── requirements.txt   # Python dependencies
│   └── .env.example       # Environment variables template
│
├── web/                   # Frontend Next.js application
│   ├── app/
│   │   ├── page.tsx       # Main dashboard
│   │   ├── network/       # Network graph page
│   │   ├── api/           # API proxy routes
│   │   └── ...
│   ├── components/        # React components
│   ├── styles/            # Global styles
│   ├── package.json       # Node dependencies
│   └── .env.local         # Frontend environment variables
│
├── archive/               # Archived files (not for deployment)
│   ├── scraping/          # Data scraping scripts
│   ├── test-files/        # Test scripts and logs
│   └── documentation/     # Old documentation
│
└── README.md              # This file
```

## 🚀 Getting Started

### Prerequisites
- **Python 3.10+**
- **Node.js 18+**
- **Supabase account** (for database)
- **API Keys**:
  - OpenAI or Grok API key (for chat)
  - Twitter API credentials (optional, for live data)

### Backend Setup

1. **Navigate to API directory**
   ```bash
   cd api
   ```

2. **Create virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials:
   # - SUPABASE_URL
   # - SUPABASE_SERVICE_ROLE_KEY
   # - OPENAI_API_KEY or GROK_API_KEY
   ```

5. **Run the server**
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

   API will be available at: `http://localhost:8000`
   API docs: `http://localhost:8000/docs`

### Frontend Setup

1. **Navigate to web directory**
   ```bash
   cd web
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.local.example .env.local
   # Edit .env.local:
   # NEXT_PUBLIC_API_BASE=http://localhost:8000
   ```

4. **Run development server**
   ```bash
   npm run dev
   ```

   App will be available at: `http://localhost:3000`

## 🗄️ Database Schema

### Key Tables

**`twitter_relationships`** - Network connections
- `source_username` - Person who follows
- `target_username` - Person being followed
- `following` - Whether source follows target
- `followed_by` - Whether source is followed by target
- `checked_at` - Timestamp of relationship check

**`twitter_user_corpus`** - User profiles and data
- `user_id` - Twitter user ID
- `username` - Twitter handle
- `name` - Display name
- `doc_text` - Aggregated tweet corpus
- `linkedin_profile_2` - LinkedIn profile JSON
- `career_clean` - Parsed career history
- `career_salary` - Salary estimates

**`researchers`** - Curated researcher list
- `name` - Full name
- `organization` - Current affiliation
- `handle` - Twitter username
- `scholar_url` - Google Scholar profile
- `linkedin_url` - LinkedIn profile

## 🔌 API Endpoints

### Relationships
- `GET /relationships` - List all network relationships
- `GET /relationships/{username}` - Get user's relationships
- `GET /relationships/network/stats` - Network statistics
- `POST /relationships/profiles/batch` - Batch fetch user profiles

### Catalog & Search
- `GET /catalog` - List available researcher catalogs
- `POST /search` - Start new researcher search
- `GET /search/{search_id}` - Get search status

### Candidates
- `GET /candidate/{candidate_id}` - Get researcher details
- `GET /candidate/{candidate_id}/tweets` - Get researcher tweets
- `POST /candidate/{candidate_id}/chat` - Chat with researcher profile

### Chat
- `POST /chat/twitter/{username}` - Chat using Twitter data

## 🎨 Network Graph Features

### Controls
- **Pan**: Click and drag empty space
- **Zoom**: Scroll wheel or pinch gesture  
- **Search**: Find specific users with auto-zoom
- **Click node**: View profile and highlight connections
- **Drag nodes**: Reposition nodes manually

### Visual Legend
- **Node size**: All uniform (24px radius)
- **Node images**: Profile pictures from LinkedIn
- **Link colors**: 
  - Bright = Selected node's connections
  - Faded = Other connections
- **Link width**:
  - Thick (3px) = Connected to selected node
  - Thin (0.8px) = Default

### Physics Configuration
- **Strong repulsion** (-8000 charge) prevents overlap
- **Large collision padding** (+80px) ensures spacing
- **Long links** (500px) for clear separation
- **Grid initialization** prevents center clustering

## 🧪 Testing

Run test files in `archive/test-files/`:
```bash
python archive/test-files/test_rag_direct.py
python archive/test-files/test_chat_system.py
```

## 📦 Deployment

### Backend (API)
- Deploy to **Heroku**, **Railway**, **AWS**, or **Google Cloud**
- Ensure environment variables are set
- Use `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### Frontend (Web)
- Deploy to **Vercel** (recommended for Next.js)
- Or use **Netlify**, **AWS Amplify**
- Set `NEXT_PUBLIC_API_BASE` to your production API URL
- Run `npm run build` for production build

### Environment Variables

**Backend (.env)**
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=sk-...
# Or use Grok
GROK_API_KEY=xai-...
```

**Frontend (.env.local)**
```bash
NEXT_PUBLIC_API_BASE=http://localhost:8000
# Or production URL
# NEXT_PUBLIC_API_BASE=https://your-api.herokuapp.com
```

## 🔐 Security Notes

- Never commit `.env` files to git
- Use environment variables for all secrets
- Supabase service role key should only be used server-side
- Enable CORS appropriately for production
- Use HTTPS in production

## 📚 Additional Documentation

See `archive/documentation/` for:
- `NETWORK_TOOL_SUMMARY.md` - Network graph technical details
- `NETWORK_PERFORMANCE_FIX.md` - Optimization explanations
- `NETWORK_GRAPH_USAGE.md` - User guide for graph
- `QUICK_START_GUIDE.md` - Quick setup guide
- Test result summaries

## 🤝 Contributing

This is a personal project. Fork and modify as needed!

## 📄 License

MIT License - Feel free to use this project as you wish.

## 🙏 Acknowledgments

- Built with FastAPI, Next.js, and Supabase
- Network visualization powered by react-force-graph-2d
- AI chat powered by OpenAI/Grok
- Profile data enriched via LinkedIn

---

**Ready to explore the AI researcher network!** 🚀

Start the backend and frontend servers, then visit `http://localhost:3000/network` to see the interactive graph.
