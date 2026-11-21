import React, { useEffect, useRef, useState } from 'react';
import { routeChatMessage } from '../../../../packages/protocol/src/index';
import { api, errorMessage } from '../api';
import { Field } from '../components/Field';
import { useWorkspace } from '../state/workspace';

type Message = { id: number; role: 'user' | 'assistant' | 'error'; text: string; files?: string[] };
let nextId = 1;

export function Chat() {
  const ws = useWorkspace();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: 'assistant', text: 'Ask about your repository, ask for reusable code, or paste a Figma link. This chat routes requests and searches code; it is not a free-form AI conversation, and code changes are always proposals.' }]);
  const logRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight }); }, [messages]);
  const add = (m: Omit<Message, 'id'>) => { if (alive.current) setMessages(list => [...list, { ...m, id: nextId++ }]); };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput(''); add({ role: 'user', text });
    const route = routeChatMessage(text);
    if (route.intent === 'figma') {
      if (route.figmaUrl) { ws.navigate('figma', { figma: { url: route.figmaUrl, nonce: Date.now() } }); add({ role: 'assistant', text: `Opened Figma-to-Code with ${route.figmaUrl}. Add your access token there to read the design.` }); }
      else { ws.navigate('figma'); add({ role: 'assistant', text: 'Opened Figma-to-Code. Paste a frame link and your access token to read the design.' }); }
      return;
    }
    if (route.intent === 'reuse') {
      ws.navigate('reuse', { reuse: { requirement: route.query, autorun: true, nonce: Date.now() } });
      add({ role: 'assistant', text: `Opened Reuse Intelligence for “${route.query}” (${route.reasons.join(', ')}).${ws.repository.trim() ? ' Discovery is running.' : ' Enter the repository path to start discovery.'}` });
      return;
    }
    setBusy(true);
    try {
      const hits = await api.search(ws.requireRepository(), route.query, 5);
      add(hits.length ? { role: 'assistant', text: `Found ${hits.length} relevant file${hits.length === 1 ? '' : 's'}:`, files: hits.map(h => `${h.file} (score ${h.score})`) } : { role: 'assistant', text: 'No matching code found. Try other words, or check that the repository is indexed.' });
    } catch (error) { add({ role: 'error', text: errorMessage(error) }); }
    finally { if (alive.current) setBusy(false); }
  };

  return (
    <section className="panel">
      <h3>codeDeft Chat</h3>
      <div className="chat-log" ref={logRef} role="log" aria-live="polite" aria-label="Conversation">
        {messages.map(m => <div key={m.id} className={'chat-message ' + m.role}><strong>{m.role === 'user' ? 'You' : 'codeDeft'}</strong><p>{m.text}</p>{m.files && <ul>{m.files.map(f => <li key={f}><code>{f}</code></li>)}</ul>}</div>)}
        {busy && <p role="status" className="muted">Searching…</p>}
      </div>
      <div className="form end"><Field className="grow" label="Message" value={input} onChange={setInput} onEnter={send} placeholder="Ask about code, reuse, or paste a Figma link" /><button type="button" disabled={busy || !input.trim()} onClick={send}>Send</button></div>
    </section>
  );
}
