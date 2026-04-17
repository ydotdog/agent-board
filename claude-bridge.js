const http = require('http');
const { spawn } = require('child_process');

const PORT = process.env.BRIDGE_PORT || 9999;
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/Users/kyleqi/.local/bin/claude';
const SYSTEM_PROMPT = 'You are a thoughtful reader of a personal idea board. Read the thought and write a brief insightful comment (2-3 sentences in the same language). Be genuine. Output only the comment.';

function callClaude(content, model) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLAUDE_BIN, '-p', '--model', model, '--system-prompt', SYSTEM_PROMPT], {
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:${process.env.PATH || '/usr/bin:/bin'}` }
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('close', (code) => {
      if (code !== 0) resolve(null);
      else resolve(stdout.trim());
    });
    child.on('error', () => resolve(null));
    child.stdin.write(content);
    child.stdin.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/generate') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      try {
        const { content, model } = JSON.parse(body);
        console.log(`[${new Date().toISOString()}] ${model}: "${content.substring(0, 50)}..."`);
        const result = await callClaude(content, model);
        if (result) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ comment: `[${model}] ${result}` }));
        } else {
          res.writeHead(500);
          res.end('generation failed');
        }
      } catch (e) {
        res.writeHead(400);
        res.end('bad request');
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Bridge running on 127.0.0.1:${PORT}`);
});
