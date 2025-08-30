## LLM Agent POC (Browser)

Minimal browser-based multi-tool agent using OpenAI-style tool/function-calling.

### Features
- Chat UI with streaming assistant output
- Tool calling with three tools:
  - `google_search`: Google Programmable Search snippets
  - `ai_pipe`: Proxy POST to a configurable endpoint
  - `js_exec`: Sandboxed JS execution via iframe
- Provider/model picker: OpenAI, OpenRouter, or custom base URL
- Bootstrap alerts for error reporting
- Settings persist in localStorage; tool outputs have copy buttons and step numbers

### Setup
1. Open `index.html` in a local web server (required for iframe messaging):
   - Python: `python3 -m http.server 8000`
   - Node: `npx http-server -p 8000`
2. Navigate to `http://localhost:8000`.

### Configure
- Enter your API key and model for your chosen provider.
- For Google Search, set `Google API Key` and `Google CSE CX`.
- For AI Pipe, set `AI Pipe Endpoint` (and optional token).

### Quick test (each tool separately)
- Google Search: "Find the latest news on IBM. Use google_search and cite 3 sources (title, link, snippet)."
- JS Exec: "Use js_exec with code: const a=[3,5,8,13,21]; const m=a.reduce((s,x)=>s+x,0)/a.length; const v=a.reduce((s,x)=>s+(x-m)**2,0)/a.length; ({mean:m,std:Math.sqrt(v)});"
- AI Pipe (echo): set endpoint to `https://httpbin.org/post` and ask: "Call ai_pipe with payload: {\"task\":\"ping\",\"data\":{\"msg\":\"hello\"}}"

### End-to-end evaluator scenario (uses all three tools)
Copy-paste as one prompt after configuring keys and endpoint (AI Pipe → `https://httpbin.org/post`):

"Create a brief blog outline on 'online gaming ban in India'.

1) Use google_search to fetch 3 recent sources and cite each (title + link + one-line snippet).

2) Use js_exec with this code to estimate reading time for a 700-word draft at 220 wpm:
const words=700, wpm=220; Math.ceil(words/wpm);

3) Call ai_pipe with payload:
{\"task\":\"title_suggestions\",\"topic\":\"online gaming ban in India\",\"keywords\":[\"regulation\",\"industry impact\",\"users\",\"revenue\",\"policy\"]}

Return: 5 title suggestions (from ai_pipe or echo), a numbered outline (5-7 bullets), Sources with links, and the reading time."

Expected UI: Tool (google_search) → snippets; Tool (js_exec) → integer minutes; Tool (ai_pipe) → echoed JSON; final assistant message with outline, titles, sources, reading time.

Tip: If a tool doesn't auto-trigger, explicitly say "Use google_search …", "Use js_exec with code: …", or "Call ai_pipe with payload: …".

### Notes
- Keys are kept in-memory only.
- This is a POC for hackability—no persistence or auth.

### Credits
- Inspired by `apiagent` (`https://github.com/sanand0/apiagent`) in spirit; trimmed to a minimal, hackable core.



