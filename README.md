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

### Setup
1. Open `index.html` in a local web server (required for iframe messaging):
   - Python: `python3 -m http.server 8000`
   - Node: `npx http-server -p 8000`
2. Navigate to `http://localhost:8000`.

### Configure
- Enter your API key and model for your chosen provider.
- For Google Search, set `Google API Key` and `Google CSE CX`.
- For AI Pipe, set `AI Pipe Endpoint` (and optional token).

### Notes
- Keys are kept in-memory only.
- This is a POC for hackability—no persistence or auth.



