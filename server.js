const express = require('express');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'changeme';
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:9999';
const AI_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001'
];

// --- Auth ---
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  });
  return cookies;
}

function authMiddleware(req, res, next) {
  // Allow login page
  if (req.path === '/login' || req.path === '/api/login') return next();

  const cookies = parseCookies(req.headers.cookie);
  if (cookies.session && cookies.session === hashToken(AUTH_TOKEN)) {
    return next();
  }

  // Also accept Bearer token (for API/agent access)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7) === AUTH_TOKEN) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.redirect('/login');
}

// --- AI Comments via Claude Bridge ---
function generateAIComment(postContent, model) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ content: postContent, model });
    const url = new URL('/generate', BRIDGE_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 60000
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const { comment } = JSON.parse(body);
            console.log(`AI comment (${model}):`, comment.substring(0, 80));
            resolve(comment);
          } catch { resolve(null); }
        } else {
          console.error(`Bridge error (${model}): ${res.statusCode}`);
          resolve(null);
        }
      });
    });
    req.on('error', (err) => {
      console.error(`Bridge unreachable (${model}): ${err.message}`);
      resolve(null);
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(data);
    req.end();
  });
}

// --- App ---
app.use(express.json());

// Login endpoints (before auth middleware)
app.get('/login', (req, res) => {
  // If already authenticated, redirect to home
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.session && cookies.session === hashToken(AUTH_TOKEN)) {
    return res.redirect('/');
  }
  res.send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Agent Board - Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.login{background:#111;border:1px solid #222;border-radius:12px;padding:32px;width:320px}
.login h1{font-size:18px;margin-bottom:20px;color:#fff;text-align:center}
.login input{width:100%;background:transparent;border:1px solid #333;color:#e0e0e0;font-size:15px;padding:10px 12px;border-radius:8px;outline:none;margin-bottom:12px}
.login input:focus{border-color:#555}
.login button{width:100%;background:#fff;color:#000;border:none;padding:10px;border-radius:20px;font-size:14px;font-weight:600;cursor:pointer}
.login button:hover{opacity:0.85}
.err{color:#e55;font-size:13px;text-align:center;margin-bottom:12px;display:none}
</style></head><body>
<div class="login">
<h1>Agent Board</h1>
<div class="err" id="err">Invalid token</div>
<input type="password" id="token" placeholder="Enter token" autofocus>
<button onclick="login()">Login</button>
</div>
<script>
document.getElementById('token').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
async function login(){
  const token=document.getElementById('token').value;
  const res=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  if(res.ok){window.location.href='/'}
  else{document.getElementById('err').style.display='block'}
}
</script></body></html>`);
});

app.post('/api/login', (req, res) => {
  const { token } = req.body;
  if (token === AUTH_TOKEN) {
    res.setHeader('Set-Cookie', `session=${hashToken(AUTH_TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'invalid token' });
});

// Auth wall
app.use(authMiddleware);

// Static files (after auth)
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---

// Create a post
app.post('/api/posts', (req, res) => {
  const { content, tags } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  const tagsJson = JSON.stringify(tags || []);
  const stmt = db.prepare('INSERT INTO posts (content, tags) VALUES (?, ?)');
  const result = stmt.run(content.trim(), tagsJson);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
  post.tags = JSON.parse(post.tags);
  res.status(201).json(post);

  // All models comment in parallel
  const postId = post.id;
  const trimmed = content.trim();
  AI_MODELS.forEach(model => {
    generateAIComment(trimmed, model).then(aiComment => {
      if (aiComment) {
        try {
          db.prepare('INSERT INTO comments (post_id, content) VALUES (?, ?)').run(postId, aiComment);
          console.log(`${model} commented on post #${postId}`);
        } catch (err) {
          console.error(`DB error saving comment for post #${postId} (${model}):`, err.message);
        }
      } else {
        console.warn(`${model} returned no comment for post #${postId}`);
      }
    }).catch(err => {
      console.error(`Unexpected error generating comment for post #${postId} (${model}):`, err.message);
    });
  });
});

// List posts (agent-friendly)
app.get('/api/posts', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const tag = req.query.tag;
  const search = req.query.q;
  const offset = (page - 1) * limit;

  let where = [];
  let params = [];

  if (tag) {
    where.push("tags LIKE ?");
    params.push(`%"${tag}"%`);
  }
  if (search) {
    where.push("content LIKE ?");
    params.push(`%${search}%`);
  }

  where.push("deleted_at IS NULL");
  const whereClause = 'WHERE ' + where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) as count FROM posts ${whereClause}`).get(...params).count;
  const posts = db.prepare(`SELECT * FROM posts ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  posts.forEach(p => p.tags = JSON.parse(p.tags));

  res.json({
    posts,
    meta: { total, page, limit, pages: Math.ceil(total / limit) }
  });
});

// List posts as Markdown (LLM-friendly)
app.get('/api/posts.md', (req, res) => {
  const tag = req.query.tag;
  const search = req.query.q;
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));

  let where = [];
  let params = [];

  if (tag) {
    where.push("tags LIKE ?");
    params.push(`%"${tag}"%`);
  }
  if (search) {
    where.push("content LIKE ?");
    params.push(`%${search}%`);
  }

  where.push("deleted_at IS NULL");
  const whereClause = 'WHERE ' + where.join(' AND ');
  const posts = db.prepare(`SELECT * FROM posts ${whereClause} ORDER BY created_at DESC LIMIT ?`).all(...params, limit);

  let md = `# Agent Board\n\n`;
  md += `> ${posts.length} posts`;
  if (tag) md += ` | tag: ${tag}`;
  if (search) md += ` | search: "${search}"`;
  md += `\n\n---\n\n`;

  posts.forEach(p => {
    const tags = JSON.parse(p.tags);
    const tagStr = tags.length ? ` [${tags.join(', ')}]` : '';
    md += `### #${p.id} — ${p.created_at}${tagStr}\n\n${p.content}\n\n`;
    const comments = db.prepare('SELECT * FROM comments WHERE post_id = ? AND deleted_at IS NULL ORDER BY created_at ASC').all(p.id);
    if (comments.length) {
      md += `**Comments (${comments.length}):**\n\n`;
      comments.forEach(c => {
        md += `- _${c.created_at}_ — ${c.content}\n`;
      });
      md += `\n`;
    }
    md += `---\n\n`;
  });

  res.type('text/markdown').send(md);
});

// Get single post (with comments)
app.get('/api/posts/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'not found' });
  post.tags = JSON.parse(post.tags);
  post.comments = db.prepare('SELECT * FROM comments WHERE post_id = ? AND deleted_at IS NULL ORDER BY created_at ASC').all(post.id);
  res.json(post);
});

// List comments for a post
app.get('/api/posts/:id/comments', (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'post not found' });
  const comments = db.prepare('SELECT * FROM comments WHERE post_id = ? AND deleted_at IS NULL ORDER BY created_at ASC').all(req.params.id);
  res.json({ comments });
});

// Add a comment to a post
app.post('/api/posts/:id/comments', (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'post not found' });
  const stmt = db.prepare('INSERT INTO comments (post_id, content) VALUES (?, ?)');
  const result = stmt.run(req.params.id, content.trim());
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(comment);
});

// Update a post
app.put('/api/posts/:id', (req, res) => {
  const { content, tags } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'not found' });
  const tagsJson = JSON.stringify(tags || JSON.parse(post.tags));
  db.prepare('UPDATE posts SET content = ?, tags = ? WHERE id = ?').run(content.trim(), tagsJson, req.params.id);
  const updated = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  updated.tags = JSON.parse(updated.tags);
  res.json(updated);
});

// Soft delete a comment
app.delete('/api/comments/:id', (req, res) => {
  const result = db.prepare("UPDATE comments SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// Soft delete a post (and its comments)
app.delete('/api/posts/:id', (req, res) => {
  const result = db.prepare("UPDATE posts SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE comments SET deleted_at = datetime('now') WHERE post_id = ? AND deleted_at IS NULL").run(req.params.id);
  res.json({ ok: true });
});

// Bridge health check
app.get('/api/bridge/health', (req, res) => {
  const url = new URL('/health', BRIDGE_URL);
  const hreq = http.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'GET',
    timeout: 5000
  }, (hres) => {
    let body = '';
    hres.on('data', (d) => { body += d; });
    hres.on('end', () => {
      res.json({ bridge: hres.statusCode === 200 ? 'ok' : 'error', status: hres.statusCode, url: BRIDGE_URL });
    });
  });
  hreq.on('error', (err) => {
    res.json({ bridge: 'unreachable', error: err.message, url: BRIDGE_URL });
  });
  hreq.on('timeout', () => { hreq.destroy(); res.json({ bridge: 'timeout', url: BRIDGE_URL }); });
  hreq.end();
});

app.listen(PORT, () => {
  console.log(`Agent Board running at http://localhost:${PORT}`);
});
