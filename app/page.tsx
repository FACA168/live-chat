'use client';

import { useEffect, useState, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { Paperclip, Send } from 'lucide-react';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Message = {
  id: number;
  session_id: string;
  sender_type: 'user' | 'admin';
  content?: string;
  image_url?: string;
  file_url?: string;
  file_name?: string;
  is_revoked: boolean;
  created_at: string;
};

export default function UserChat() {
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let sid = localStorage.getItem('chat_session_id');
    if (!sid) {
      sid = uuidv4();
      localStorage.setItem('chat_session_id', sid);
    }
    setSessionId(sid);
    supabase
      .from('visitors')
      .upsert(
        { session_id: sid, is_online: true, last_seen: new Date().toISOString() },
        { onConflict: 'session_id' }
      )
      .then();
    const timer = setInterval(() => {
      supabase
        .from('visitors')
        .update({ is_online: true, last_seen: new Date().toISOString() })
        .eq('session_id', sid)
        .then();
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages(data || []));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel('user-' + sessionId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message])
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` },
        (payload) =>
          setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? (payload.new as Message) : m)))
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (type: 'text' | 'image' | 'file') => {
    if (!sessionId) return;
    const { data: banned } = await supabase
      .from('banned_visitors')
      .select('session_id')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (banned) { alert('你已被客服拉黑，无法发送消息'); return; }

    let content = '', image_url = '', file_url = '', file_name = '';
    if (type === 'text') {
      content = input.slice(0, 1000);
      if (!content.trim()) return;
      setInput('');
    } else if (file) {
      const ext = file.name.split('.').pop();
      const path = `${sessionId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('chat-assets').upload(path, file);
      if (error) { alert('上传失败'); return; }
      const { data } = supabase.storage.from('chat-assets').getPublicUrl(path);
      if (type === 'image') image_url = data.publicUrl;
      else { file_url = data.publicUrl; file_name = file.name; }
      setFile(null);
    }

    await supabase.from('messages').insert({
      session_id: sessionId, sender_type: 'user', content, image_url, file_url, file_name
    });
  };

  const recall = async (id: number) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg || Date.now() - new Date(msg.created_at).getTime() > 120000) return alert('已超过2分钟');
    await supabase.from('messages').update({ is_revoked: true }).eq('id', id);
  };

  useEffect(() => {
    if (!sessionId) return;
    supabase
      .from('typing_status')
      .upsert(
        { session_id: sessionId, is_typing: input.length > 0, updated_at: new Date().toISOString() },
        { onConflict: 'session_id' }
      )
      .then();
  }, [input, sessionId]);

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto border-x">
      <div className="bg-blue-500 text-white p-4 text-center font-bold">在线客服</div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-lg ${msg.sender_type === 'user' ? 'bg-blue-500 text-white' : 'bg-white shadow'}`}>
              {msg.is_revoked ? <span className="italic">消息已撤回</span> : (
                <>
                  {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                  {msg.image_url && <img src={msg.image_url} className="max-w-full rounded cursor-pointer mt-2" onClick={() => window.open(msg.image_url)} />}
                  {msg.file_url && <a href={msg.file_url} download={msg.file_name} className="flex items-center gap-2 mt-2 underline"><Paperclip size={16} />{msg.file_name}</a>}
                </>
              )}
              <div className="text-xs mt-1 opacity-70 flex justify-end gap-2">
                {format(new Date(msg.created_at), 'HH:mm')}
                {msg.sender_type === 'user' && !msg.is_revoked && Date.now() - new Date(msg.created_at).getTime() < 120000 && (
                  <button onClick={() => recall(msg.id)}>撤回</button>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="border-t bg-white p-3 flex items-center gap-2">
        <input type="file" ref={fileInputRef} hidden accept="image/*,.pdf,.doc,.docx,.zip" onChange={e => setFile(e.target.files?.[0] || null)} />
        <button onClick={() => fileInputRef.current?.click()} className="p-2 hover:bg-gray-100 rounded"><Paperclip size={20} /></button>
        <input className="flex-1 border rounded-full px-4 py-2" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send('text'); }} placeholder="输入消息..." maxLength={1000} />
        <button onClick={() => file ? (file.type.startsWith('image/') ? send('image') : send('file')) : send('text')} disabled={!input.trim() && !file} className="p-2 bg-blue-500 text-white rounded-full disabled:opacity-50"><Send size={20} /></button>
      </div>
    </div>
  );
}