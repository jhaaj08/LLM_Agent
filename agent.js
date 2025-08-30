// Minimal browser LLM agent with OpenAI-style tool calling and streaming
// Tools: google_search, ai_pipe, js_exec

const els = {
  alerts: document.getElementById('alerts'),
  chat: document.getElementById('chat'),
  inputForm: document.getElementById('inputForm'),
  userInput: document.getElementById('userInput'),
  provider: document.getElementById('provider'),
  model: document.getElementById('model'),
  apiKey: document.getElementById('apiKey'),
  customBaseWrap: document.getElementById('customBaseWrap'),
  customBaseUrl: document.getElementById('customBaseUrl'),
  googleKey: document.getElementById('googleKey'),
  googleCx: document.getElementById('googleCx'),
  aipipeUrl: document.getElementById('aipipeUrl'),
  aipipeToken: document.getElementById('aipipeToken'),
  stopBtn: document.getElementById('stopBtn'),
  clearBtn: document.getElementById('clearBtn'),
  sandbox: document.getElementById('sandbox'),
  pickProviderBtn: document.getElementById('pickProviderBtn'),
  apiKeyWrap: document.getElementById('apiKeyWrap'),
};

let abortController = null;
let conversation = [
  {
    role: 'system',
    content:
      'You are a helpful browser-based agent. Use tools when needed. Prefer concise answers. Tools available: google_search (for web snippets), ai_pipe (proxy API), js_exec (sandboxed JS). When you call tools, ask only for what you need and then integrate results before continuing. Continue calling tools until the task is complete. Interviewing mode: ask exactly one question at a time and wait for the user\'s answer before asking the next. Do not batch multiple questions in one message. If the user asks for “recent”, “latest”, “today”, or “news” information, prioritize calling google_search first, then synthesize.'
  }
];
let running = false;
let stepCounter = 0;

// Settings persistence (apiagent-inspired)
const SETTINGS_KEY = 'llm_agent_settings_v1';

function serializeSettings() {
  return {
    provider: els.provider.value,
    model: els.model.value,
    apiKey: els.apiKey.value,
    customBaseUrl: els.customBaseUrl.value,
    googleKey: els.googleKey.value,
    googleCx: els.googleCx.value,
    aipipeUrl: els.aipipeUrl.value,
    aipipeToken: els.aipipeToken.value,
    managedByPicker: !!els.apiKey.dataset.managedByPicker,
  };
}

function applySettings(s) {
  if (!s) return;
  if (s.provider) els.provider.value = s.provider;
  if (s.model) els.model.value = s.model;
  if (s.apiKey) els.apiKey.value = s.apiKey;
  if (s.customBaseUrl) els.customBaseUrl.value = s.customBaseUrl;
  if (s.googleKey) els.googleKey.value = s.googleKey;
  if (s.googleCx) els.googleCx.value = s.googleCx;
  if (s.aipipeUrl) els.aipipeUrl.value = s.aipipeUrl;
  if (s.aipipeToken) els.aipipeToken.value = s.aipipeToken;
  els.customBaseWrap.classList.toggle('d-none', els.provider.value !== 'custom');
  if (s.managedByPicker) {
    els.apiKey.dataset.managedByPicker = 'true';
    els.apiKey.disabled = true;
    els.apiKeyWrap?.classList.add('d-none');
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(serializeSettings())); } catch {}
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) applySettings(JSON.parse(raw));
  } catch {}
}

// UI helpers
function showAlert(kind, text) {
  const id = `alert-${Date.now()}`;
  const html = `<div id="${id}" class="alert alert-${kind} alert-dismissible fade show" role="alert">${escapeHtml(text)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
  els.alerts.insertAdjacentHTML('beforeend', html);
  return id;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function addMessage(role, content, meta = {}) {
  const node = document.createElement('div');
  node.className = `msg ${role}`;
  const bubble = role === 'user' ? `<span class="bubble">${escapeHtml(content)}</span>` : escapeHtml(content);
  const label = role === 'user' ? 'You' : role === 'assistant' ? 'Agent' : 'Tool';
  node.innerHTML = `<span class="role">${label}:</span> <span>${bubble}</span>`;
  els.chat.appendChild(node);
  els.chat.scrollTop = els.chat.scrollHeight;
  if (role !== 'tool' && !meta.noRecord) conversation.push({ role, content, ...meta });
}

// Extraction helpers (fallbacks when model omits tool args)
function getRecentUserText(maxTurns = 3) {
  const users = conversation.filter(m => m.role === 'user').slice(-maxTurns);
  return users.map(m => m.content || '').join('\n');
}

function findFirstJsonObject(text) {
  if (!text) return null;
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start !== -1) {
      const candidate = text.slice(start, i + 1);
      try { return JSON.parse(candidate); } catch {}
    }}
  }
  return null;
}

function extractJsonLabeled(text, label) {
  if (!text) return null;
  const idx = text.toLowerCase().lastIndexOf(label.toLowerCase());
  if (idx === -1) return null;
  const tail = text.slice(idx);
  return findFirstJsonObject(tail);
}

function extractCodeFromText(text) {
  if (!text) return '';
  const fence = text.match(/```(?:js|javascript)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const codeColon = text.match(/code\s*:\s*([\s\S]*)$/i);
  if (codeColon) return codeColon[1].trim();
  return '';
}

function updateLastAssistantPartial(text) {
  const nodes = els.chat.querySelectorAll('.msg.assistant');
  const last = nodes[nodes.length - 1];
  if (!last) return;
  last.querySelector('span:nth-child(2)').innerHTML = escapeHtml(text) + ' <span class="streaming-cursor"></span>';
  els.chat.scrollTop = els.chat.scrollHeight;
}

function finalizeLastAssistant(text) {
  const nodes = els.chat.querySelectorAll('.msg.assistant');
  const last = nodes[nodes.length - 1];
  if (!last) return;
  last.querySelector('span:nth-child(2)').textContent = text;
}

// Provider selection UI
els.provider.addEventListener('change', () => {
  const val = els.provider.value;
  els.customBaseWrap.classList.toggle('d-none', val !== 'custom');
  saveSettings();
});

els.clearBtn.addEventListener('click', () => {
  conversation = [];
  els.chat.innerHTML = '';
});

// Persist settings on edits
['input', 'change'].forEach(evt => {
  [els.model, els.apiKey, els.customBaseUrl, els.googleKey, els.googleCx, els.aipipeUrl, els.aipipeToken].forEach(el => {
    el.addEventListener(evt, saveSettings);
  });
});
loadSettings();

// bootstrap-llm-provider integration (CDN dynamic import)
els.pickProviderBtn?.addEventListener('click', async () => {
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1.2');
    const { openaiConfig } = mod;
    const { baseUrl, apiKey, models } = await openaiConfig({
      baseUrls: [
        { url: 'https://api.openai.com/v1', name: 'OpenAI' },
        { url: 'https://openrouter.ai/api/v1', name: 'OpenRouter' },
        { url: 'https://api.groq.com/openai/v1', name: 'Groq' },
        { url: 'http://localhost:11434/v1', name: 'Ollama (local)' },
      ],
      help: '<div class="alert alert-info mb-2">Enter your OpenAI/OpenRouter base URL and key. This demo stores it locally.</div>',
      show: true,
    });
    if (baseUrl) {
      els.provider.value = baseUrl.includes('openrouter') ? 'openrouter' : (baseUrl.includes('openai') ? 'openai' : 'custom');
      els.customBaseUrl.value = baseUrl;
      els.customBaseWrap.classList.toggle('d-none', els.provider.value !== 'custom');
    }
    if (apiKey) {
      els.apiKey.value = apiKey;
      els.apiKey.dataset.managedByPicker = 'true';
      els.apiKey.disabled = true;
      els.apiKeyWrap?.classList.add('d-none');
    }
    if (Array.isArray(models) && models.length && !els.model.value) els.model.value = models[0];
    saveSettings();
    showAlert('success', 'Provider configured');
  } catch (e) {
    showAlert('danger', `Provider picker error: ${String(e && e.message || e)}`);
  }
});

// Tools
const tools = [
  {
    type: 'function',
    function: {
      name: 'google_search',
      description: 'Search the web with Google Programmable Search and return top snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          num: { type: 'number', description: 'Number of results (1-5)', minimum: 1, maximum: 5, default: 3 }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ai_pipe',
      description: 'Call AI Pipe proxy for flexible dataflows. Returns JSON result.',
      parameters: {
        type: 'object',
        properties: {
          payload: { type: 'object', description: 'Arbitrary JSON payload to send' }
        },
        required: ['payload']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'js_exec',
      description: 'Execute JavaScript code safely in a sandbox and return the stdout/result.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript code to execute' }
        },
        required: ['code']
      }
    }
  }
];

// Tool implementations
async function handleToolCall(call) {
  const name = call.function.name;
  const args = JSON.parse(call.function.arguments || '{}');
  try {
    if (name === 'google_search') {
      const key = els.googleKey.value.trim();
      const cx = els.googleCx.value.trim();
      if (!key || !cx) throw new Error('Google key or CSE CX missing');
      let query = (args.query || '').trim();
      if (!query) {
        const uText = getRecentUserText(2);
        // crude fallback: take the line after 'search' or the whole text
        const m = uText.match(/search\s*(for|:)\s*([^\n]+)/i);
        query = (m ? m[2] : uText).slice(0, 200);
      }
      const q = encodeURIComponent(query);
      const num = Math.min(5, Math.max(1, args.num || 3));
      const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&num=${num}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Google search failed: ${res.status}`);
      const data = await res.json();
      const snippets = (data.items || []).map(it => ({ title: it.title, link: it.link, snippet: it.snippet }));
      addToolMessage('google_search', JSON.stringify(snippets, null, 2));
      return { tool_call_id: call.id, role: 'tool', name, content: JSON.stringify({ snippets }) };
    }
    if (name === 'ai_pipe') {
      const url = els.aipipeUrl.value.trim();
      if (!url) throw new Error('AI Pipe endpoint missing');
      const token = els.aipipeToken.value.trim();
      let payload = args.payload;
      if (!payload || (typeof payload === 'object' && Object.keys(payload).length === 0)) {
        const uText = getRecentUserText(3);
        payload = extractJsonLabeled(uText, 'payload') || findFirstJsonObject(uText) || {};
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload || {})
      });
      if (!res.ok) throw new Error(`AI Pipe failed: ${res.status}`);
      const data = await res.json().catch(async () => ({ text: await res.text() }));
      addToolMessage('ai_pipe', JSON.stringify(data, null, 2));
      return { tool_call_id: call.id, role: 'tool', name, content: JSON.stringify(data) };
    }
    if (name === 'js_exec') {
      let code = String(args.code || '');
      if (!code.trim()) {
        const uText = getRecentUserText(3);
        code = extractCodeFromText(uText) || '';
      }
      const result = await executeInSandbox(code);
      addToolMessage('js_exec', result.ok ? result.stdout : `Error: ${result.error}`);
      return { tool_call_id: call.id, role: 'tool', name, content: JSON.stringify(result) };
    }
    throw new Error(`Unknown tool ${name}`);
  } catch (err) {
    showAlert('danger', `${name} error: ${String(err && err.message || err)}`);
    return { tool_call_id: call.id, role: 'tool', name, content: JSON.stringify({ error: String(err && err.message || err) }) };
  }
}

function addToolMessage(toolName, text) {
  stepCounter += 1;
  const node = document.createElement('div');
  node.className = 'msg tool';
  node.innerHTML = `
    <div class="d-flex justify-content-between align-items-center">
      <span class="role">Tool (${escapeHtml(toolName)}) — Step ${stepCounter}:</span>
      <button class="btn btn-sm btn-outline-secondary copy-btn">Copy</button>
    </div>
    <pre class="m-0">${escapeHtml(text)}</pre>`;
  els.chat.appendChild(node);
  const copyBtn = node.querySelector('.copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        showAlert('success', 'Copied tool output');
      } catch (e) {
        showAlert('danger', 'Copy failed');
      }
    });
  }
  els.chat.scrollTop = els.chat.scrollHeight;
}

function executeInSandbox(code) {
  return new Promise((resolve) => {
    const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onMessage = (event) => {
      const data = event.data || {};
      if (data.type === 'execute-js-result' && data.id === id) {
        window.removeEventListener('message', onMessage);
        resolve({ ok: !!data.ok, stdout: data.stdout || '', error: data.error });
      }
    };
    window.addEventListener('message', onMessage);
    els.sandbox.contentWindow.postMessage({ type: 'execute-js', id, code }, '*');
  });
}

// OpenAI-compatible client (fetch-based)
async function openaiChatCompletionsStream(body, baseUrl, apiKey, signal) {
  const url = `${baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal
  });
  if (!res.ok) throw new Error(`LLM error: ${res.status}`);
  return res.body;
}

function getBaseUrl() {
  const provider = els.provider.value;
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (provider === 'groq') return 'https://api.groq.com/openai/v1';
  if (provider === 'ollama') return 'http://localhost:11434/v1';
  if (provider === 'custom') return els.customBaseUrl.value.trim() || 'https://example.com/v1';
  return 'https://api.openai.com/v1';
}

// Agent loop
async function agentLoop(userMessage) {
  const model = els.model.value.trim();
  const apiKey = els.apiKey.value.trim();
  const baseUrl = getBaseUrl();
  if (!apiKey) { showAlert('warning', 'Missing API key'); return; }

  const msgs = [...conversation];
  const trimmed = (userMessage || '').trim();
  if (trimmed) {
    msgs.push({ role: 'user', content: trimmed });
    addMessage('user', trimmed);
  }
  addMessage('assistant', '');

  abortController = new AbortController();
  running = true;
  els.stopBtn.disabled = false;

  try {
    // Light heuristic: nudge the model by appending a system hint when the last user turn suggests newsy queries
    const needsNews = /\b(news|recent|latest|today|breaking)\b/i.test(trimmed);
    const nudged = needsNews ? [
      ...msgs,
      { role: 'system', content: 'User requested recent information. Consider calling google_search.' }
    ] : msgs;

    const stream = await openaiChatCompletionsStream({
      model,
      messages: nudged,
      tools,
      tool_choice: 'auto'
    }, baseUrl, apiKey, abortController.signal);

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let assistantText = '';
    let pendingToolCalls = [];
    const toolIdBaseTs = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta || {};
          if (delta.content) {
            assistantText += delta.content;
            updateLastAssistantPartial(assistantText);
          }
          if (delta.tool_calls) {
            // accumulate tool call deltas per OpenAI streaming schema
            for (const d of delta.tool_calls) {
              const idx = d.index || 0;
              pendingToolCalls[idx] = pendingToolCalls[idx] || { id: d.id || `call_${idx}_${toolIdBaseTs}`, type: 'function', function: { name: '', arguments: '' } };
              const cur = pendingToolCalls[idx];
              cur.id = d.id || cur.id;
              if (d.function?.name) cur.function.name = d.function.name;
              if (d.function?.arguments) cur.function.arguments += d.function.arguments;
            }
          }
        } catch (e) {
          // ignore JSON parse errors from keepalive lines
        }
      }
    }

    finalizeLastAssistant(assistantText || '(no text)');

    // If there are tool calls, execute them (in parallel) and loop again
    const toolCalls = (pendingToolCalls || []).filter(Boolean);
    if (toolCalls.length > 0) {
      const toolResults = await Promise.all(toolCalls.map(handleToolCall));
      // Continue loop with assistant's tool calls and their results
      conversation.push({ role: 'assistant', content: assistantText || '', tool_calls: toolCalls });
      for (const r of toolResults) conversation.push(r);
      // Display a small notice (UI only, not part of conversation)
      addMessage('assistant', 'Working with tools...', { noRecord: true });
      // Recurse without adding a new user message
      await agentLoop(null);
      return;
    }

    // No tools requested: wait for the next user input (do not auto-loop)
    conversation.push({ role: 'assistant', content: assistantText });
  } catch (err) {
    showAlert('danger', `Agent error: ${String(err && err.message || err)}`);
  } finally {
    running = false;
    els.stopBtn.disabled = true;
    abortController = null;
  }
}

// Form events
els.inputForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (running) return;
  const text = els.userInput.value.trim();
  if (!text) return;
  els.userInput.value = '';
  await agentLoop(text);
});

els.stopBtn.addEventListener('click', () => {
  if (abortController) try { abortController.abort(); } catch {}
  running = false;
  els.stopBtn.disabled = true;
});


