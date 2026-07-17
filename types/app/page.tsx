'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { Paperclip, Send, User, UploadCloud } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import type { Message } from '@/types';

const bluePalette = ['bg-blue-500', 'bg-blue-600', 'bg-indigo-500', 'bg-cyan-500', 'bg-sky-500'];

export default function UserChat() {
  const supabase = getSupabase();
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 初始化会话ID + 上报在线状态 + 智能心跳
  useEffect(() => {
    let sid = localStorage.getItem('chat_session_id');
    if (!sid) {
      sid = uuidv4();
      localStorage.setItem('chat_session_id', sid);
    }
    setSessionId(sid);

    const initVisitor = async () => {
      try {
        await supabase
          .from('visitors')
          .upsert(
            {
              session_id: sid,
              is_online: true,
              last_seen: new Date().toISOString(),
              nickname: `访客-${sid.slice(0, 7)}`
            },
            { onConflict: 'session_id' }
          );
      } catch (e) {
        console.error('访客初始化失败', e);
      }
    };
    initVisitor();

    // 智能心跳：仅页面可见时上报
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        supabase
          .from('visitors')
          .update({ is_online: true, last_seen: new Date().toISOString() })
          .eq('session_id', sid)
          .catch(() => {});
      }
    }, 30000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && sid) {
        supabase
          .from('visitors')
          .update({ is_online: true, last_seen: new Date().toISOString() })
          .eq('session_id', sid)
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // 加载历史消息
  useEffect(() => {
    if (!sessionId) return;
    const loadMessages = async () => {
      try {
        const { data } = await supabase
          .from('messages')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true });
        setMessages(data || []);
      } catch (e) {
        console.error('加载消息失败', e);
      }
    };
    loadMessages();
  }, [sessionId, supabase]);

  // 实时订阅消息变更
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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log('实时连接已建立');
      });

    return () => { supabase.removeAllChannels(); };
  }, [sessionId, supabase]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 发送消息 - 全流程错误捕获 + 进度提示
  const send = useCallback(async (type: 'text' | 'image' | 'file') => {
    if (!sessionId || isSending) return;
    setIsSending(true);
    setUploadProgress(0);

    try {
      // 校验是否被拉黑
      const { data: banned } = await supabase
        .from('banned_visitors')
        .select('session_id')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (banned) { alert('你已被客服拉黑，无法发送消息');
        setIsSending(false); return; }

      let content = '', image_url = '', file_url = '', file_name = '';
      if (type === 'text') {
        content = input.slice(0, 1000);
        if (!content.trim()) { setIsSending(false); return; }
        setInput('');
      } else if (file) {
        // 文件大小校验：最大10MB
        if (file.size > 10 * 1024 * 1024) {
          alert('文件大小不能超过10MB');
          setIsSending(false);
          return;
        }
        const ext = file.name.split('.').pop();
        const path = `${sessionId}/${Date.now()}.${ext}`;

        // 带进度上传
        const { error } = await supabase.storage.from('chat-assets').upload(path, file, {
          upsert: false,
          onUploadProgress: (event) => {
            const progress = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(progress);
          }
        });
        if (error) { alert('上传失败：' + error.message); setIsSending(false);
          return; }

        const { data } = supabase.storage.from('chat-assets').getPublicUrl(path);
        if (type === 'image') image_url = data.publicUrl;
        else { file_url = data.publicUrl; file_name = file.name; }
        setFile(null);
      }

      // 写入消息
      await supabase.from('messages').insert({
        session_id: sessionId, sender_type: 'user', content, image_url,
        file_url, file_name
      });
    } catch (e) {
      console.error('发送消息失败', e);
      alert('网络异常，请稍后重试');
    } finally {
      setIsSending(false);
      setUploadProgress(0);
    }
  }, [sessionId, input, file, isSending, supabase]);

  // 撤回消息
  const recall = useCallback(async (id: number) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg || Date.now() - new Date(msg.created_at).getTime() > 120000) {
      alert('已超过2分钟无法撤回');
      return;
    }
    try {
      await supabase.from('messages').update({ is_revoked: true }).eq('id', id);
    } catch (e) {
      console.error('撤回失败', e);
    }
  }, [messages, supabase]);

  // 输入中状态上报
  useEffect(() => {
    if (!sessionId) return;
    const updateTyping = async () => {
      try {
        await supabase
          .from('typing_status')
          .upsert(
            { session_id: sessionId, is_typing: input.length > 0, updated_at: new Date().toISOString() },
            { onConflict: 'session_id' }
          );
      } catch (e) {}
    };
    const timer = setTimeout(updateTyping, 300);
    return () => clearTimeout(timer);
  }, [input, sessionId, supabase]);

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto border-x border-blue-100 bg-gradient-to-b from-blue-50 to-white">
      {/* 全蓝色顶部导航栏 */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white p-5 flex items-center gap-4 shadow-lg shadow-blue-200">
        <div className="h-10 w-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
          <User size={20} className="text-white" />
        </div>
        <div>
          <h1 className="font-bold text-lg">在线客服</h1>
          <p className="text-blue-100 text-xs">客服人员正在为您服务</p>
        </div>
      </div>

      {/* 聊天消息区域 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-blue-50/50 to-white">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[78%] p-3.5 rounded-2xl ${
              msg.sender_type === 'user'
                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-br-md shadow-lg shadow-blue-200'
                : 'bg-white shadow-sm border border-blue-100 rounded-bl-md'
            }`}>
              {msg.is_revoked ? <span className="italic opacity-60 text-sm">消息已撤回</span> : (
                <>
                  {msg.content && <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>}
                  {msg.image_url && <img src={msg.image_url} className="max-w-full rounded-xl cursor-pointer mt-2" onClick={() => window.open(msg.image_url)} alt="图片消息" />}
                  {msg.file_url && <a href={msg.file_url} download={msg.file_name} className={`flex items-center gap-2 mt-2 underline text-sm ${msg.sender_type === 'user' ? 'text-blue-100' : 'text-blue-600'}`}><Paperclip size={16} />{msg.file_name}</a>}
                </>
              )}
              <div className={`text-xs mt-2 flex justify-end gap-2 ${msg.sender_type === 'user' ? 'text-blue-100' : 'text-blue-400'}`}>
                {format(new Date(msg.created_at), 'HH:mm')}
                {msg.sender_type === 'user' && !msg.is_revoked && Date.now() - new Date(msg.created_at).getTime() < 120000 && (
                  <button onClick={() => recall(msg.id)} className="hover:opacity-80">撤回</button>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* 上传进度条 */}
        {isSending && uploadProgress > 0 && uploadProgress < 100 && (
          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
            <UploadCloud size={18} className="text-blue-500 animate-pulse" />
            <div className="flex-1">
              <div className="text-xs text-blue-600 mb-1">上传中 {uploadProgress}%</div>
              <div className="w-full h-1.5 bg-blue-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 底部输入区 */}
      <div className="border-t border-blue-100 bg-white p-4 flex items-center gap-3 shadow-[0_-4px_20px_rgba(59,130,246,0.05)]">
        <input type="file" ref={fileInputRef} hidden accept="image/*,.pdf,.doc,.docx,.zip" onChange={e => setFile(e.target.files?.[0] || null)} />
        <button onClick={() => fileInputRef.current?.click()} disabled={isSending} className="p-2.5 hover:bg-blue-50 rounded-xl text-blue-500 transition-all disabled:opacity-50">
          <Paperclip size={21} />
        </button>
        <input
          className="flex-1 border border-blue-100 rounded-full px-5 py-3 bg-blue-50/60 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-all"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              file ? (file.type.startsWith('image/') ? send('image') : send('file')) : send('text');
            }
          }}
          placeholder="输入消息... (Ctrl+Enter 发送)"
          maxLength={1000}
        />
        <button
          onClick={() => file ? (file.type.startsWith('image/') ? send('image') : send('file')) : send('text')}
          disabled={(!input.trim() && !file) || isSending}
          className="p-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-full disabled:opacity-50 hover:shadow-lg hover:shadow-blue-300 transition-all"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
