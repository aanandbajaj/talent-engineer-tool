# Deployment Guide

## 🚀 Quick Deploy

### Frontend (Vercel) - Recommended

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/x-ai-talent-engineer.git
   git push -u origin main
   ```

2. **Deploy to Vercel**
   - Go to https://vercel.com
   - Click "New Project"
   - Import your GitHub repository
   - **Root Directory**: Set to `web`
   - **Environment Variables**:
     - `NEXT_PUBLIC_API_BASE` = Your backend API URL
   - Click "Deploy"

3. **Done!** Your frontend is live at `https://your-app.vercel.app`

### Backend (Railway) - Recommended

1. **Go to Railway.app**
   - Sign in with GitHub
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository

2. **Configure**
   - **Root Directory**: Set to `api`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   
3. **Environment Variables** (in Railway dashboard):
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_service_key
   OPENAI_API_KEY=sk-xxx
   CORS_ORIGINS=https://your-app.vercel.app
   ```

4. **Generate Domain**: Railway will give you a URL like `https://your-app.railway.app`

5. **Update Frontend**: Go to Vercel → Settings → Environment Variables
   - Update `NEXT_PUBLIC_API_BASE` to your Railway URL
   - Redeploy frontend

### Alternative Platforms

#### Backend Alternatives
- **Heroku**: Traditional platform, easy Python deployment
- **AWS Elastic Beanstalk**: AWS managed service
- **Google Cloud Run**: Serverless container platform
- **DigitalOcean App Platform**: Simple deployment

#### Frontend Alternatives
- **Netlify**: Similar to Vercel
- **AWS Amplify**: AWS managed frontend hosting
- **Cloudflare Pages**: Fast global CDN

## 🗄️ Database (Supabase)

Your Supabase database should already be set up with:
- `twitter_relationships` table
- `twitter_user_corpus` table
- `researchers` table

Ensure Row Level Security (RLS) policies allow:
- Backend service role: Full access
- Frontend (if direct access): Read-only access

## 🔒 Security Checklist

- ✅ Never commit `.env` files
- ✅ Use service role key only on backend
- ✅ Set proper CORS_ORIGINS in production
- ✅ Use HTTPS in production (both frontend and backend)
- ✅ Keep Supabase anon key separate from service role key
- ✅ Rotate API keys if exposed

## 📝 Post-Deployment

1. **Test the network graph**: Visit `/network` and verify it loads
2. **Test search**: Try searching for a researcher
3. **Test chat**: Open a profile and test the chat feature
4. **Check logs**: Monitor Railway/Vercel logs for errors

## 🐛 Troubleshooting

### Frontend can't reach backend
- Check `NEXT_PUBLIC_API_BASE` is correct
- Verify CORS_ORIGINS includes your frontend URL
- Check Railway backend is running

### Network graph empty
- Verify Supabase credentials are correct
- Check `twitter_relationships` table has data
- Look at Network tab in browser DevTools

### Photos not loading
- Check `twitter_user_corpus` has `linkedin_profile_2` data
- Verify LinkedIn photo URLs are accessible
- Check browser console for CORS errors

## 💰 Cost Estimates

### Free Tier Limits
- **Vercel**: Unlimited for personal projects
- **Railway**: $5/month credit (usually enough for hobby projects)
- **Supabase**: 500MB database + 2GB bandwidth/month free
- **OpenAI**: Pay per use (~$0.002 per chat)

### Expected Costs (Small Project)
- **Frontend**: $0/month (Vercel free tier)
- **Backend**: $5-10/month (Railway hobby tier)
- **Database**: $0/month (Supabase free tier)
- **AI Calls**: $1-5/month (light usage)
- **Total**: ~$6-15/month

## 🎉 You're Done!

Your AI Talent Engineer app is now live and ready to use! Share the Vercel URL and start exploring the network. 🚀
