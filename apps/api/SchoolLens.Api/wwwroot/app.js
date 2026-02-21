let sessionId = null;

const urlEl = document.getElementById('url');
const scanBtn = document.getElementById('scan');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const qaEl = document.getElementById('qa');
const scoreEl = document.getElementById('score');
const summaryEl = document.getElementById('summary');
const sessionEl = document.getElementById('session');
const chatEl = document.getElementById('chat');
const qEl = document.getElementById('question');
const askBtn = document.getElementById('ask');

function addLine(role, text) {
  const p = document.createElement('p');
  p.className = role;
  p.textContent = `${role === 'user' ? 'You' : 'Assistant'}: ${text}`;
  chatEl.appendChild(p);
  chatEl.scrollTop = chatEl.scrollHeight;
}

scanBtn.addEventListener('click', async () => {
  const url = urlEl.value.trim();
  if (!url) return;

  statusEl.textContent = 'Submitting scan...';
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const data = await res.json();
  if (!res.ok) {
    statusEl.textContent = data.error || 'Scan failed';
    return;
  }

  const id = data.sessionId || data.session?.id;
  sessionId = id;
  sessionEl.textContent = `Session: ${id}`;

  if (data.cached) {
    statusEl.textContent = 'Loaded cached result.';
    scoreEl.textContent = `Score: ${data.session.overallScore ?? data.session.overall_score ?? 'N/A'}`;
    summaryEl.textContent = data.session.summary || '';
    resultEl.style.display = 'block';
    qaEl.style.display = 'block';
    chatEl.innerHTML = '';
    return;
  }

  statusEl.textContent = 'Queued. Checking status...';

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const sRes = await fetch(`/api/scan/${id}`);
    const sData = await sRes.json();
    if (sData.status === 'Ready') {
      statusEl.textContent = 'Scan complete.';
      scoreEl.textContent = `Score: ${sData.overallScore}/100`;
      summaryEl.textContent = sData.summary || '';
      resultEl.style.display = 'block';
      qaEl.style.display = 'block';
      chatEl.innerHTML = '';
      return;
    }
  }

  statusEl.textContent = 'Still processing. Retry in a few seconds.';
});

askBtn.addEventListener('click', async () => {
  const question = qEl.value.trim();
  if (!sessionId || !question) return;

  addLine('user', question);
  qEl.value = '';

  const res = await fetch(`/api/scan/${sessionId}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  const data = await res.json();
  addLine('assistant', data.answer || data.error || 'No answer');
});
