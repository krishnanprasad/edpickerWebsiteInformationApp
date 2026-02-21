let currentSessionId = null;

const urlInput = document.getElementById('urlInput');
const scanBtn = document.getElementById('scanBtn');
const scanStatus = document.getElementById('scanStatus');
const chatCard = document.getElementById('chatCard');
const questionInput = document.getElementById('questionInput');
const askBtn = document.getElementById('askBtn');
const answerEl = document.getElementById('answer');

scanBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  const response = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const data = await response.json();
  if (!response.ok) {
    scanStatus.textContent = data.error || 'Scan failed';
    return;
  }

  currentSessionId = data.sessionId || data.session?.id;
  scanStatus.textContent = `Scan queued. Session: ${currentSessionId}`;
  chatCard.style.display = 'block';
});

askBtn.addEventListener('click', async () => {
  const question = questionInput.value.trim();
  if (!question || !currentSessionId) return;

  const response = await fetch(`/api/scan/${currentSessionId}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });

  const data = await response.json();
  answerEl.textContent = data.answer || data.error || 'No answer available';
});
