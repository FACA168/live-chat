'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Send, Paperclip, LogOut, Settings, UserX, UserCheck, Circle } from 'lucide-react';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Visitor = { session_id: string; nickname: string; is_online: boolean; last_seen: string; unread: number };
type Message = { id: number; session_id: string; sender_type: 'user' | 'admin'; content?: string; image_url?: string; file_url?: string; file_name?: string; is_revoked: boolean; created_at: string };
type AdminInfo = { display_name: string; avatar_url: string; welcome_message: string; logo_url: string };

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user || null);
    });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoginError('登录失败，请检查邮箱和密码');
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    }
  };

  if (user === undefined) return <div className="min-h-screen flex items-center justify-center">加载中...</div>;

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-lg shadow-md w-96">
          <h1 className="text-2xl font-bold mb-6 text-center">客服登录</h1>
          {loginError && <div className="bg-red-50 text-red-600 p-2 rounded mb-4 text-sm">{loginError}</div>}
          <input type="email" className="border w-full p-2 mb-4 rounded focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="管理员邮箱" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" className="border w-full p-2 mb-6 rounded focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} required />
          <button type="submit" className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition">登录</button>
        </form>
      </div>
    );
  }

  return <AdminPanel user={user} />;
}

function AdminPanel({ user }: { user: any }) {
  const router = useRouter();
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [adminInfo, setAdminInfo] = useState<AdminInfo>({ display_name: '客服', avatar_url: '', welcome_message: '您好，有什么可以帮您？', logo_url: '' });
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from('admins').select('*').eq('id', user.id).single().then(({ data }) => {
      if (data) setAdminInfo(data);
    });
  }, [user.id]);

  const loadVisitors = useCallback(async () => {
    const { data: v } = await supabase.from('visitors').select('*').order('is_online', { ascending: false }).order('last_seen', { ascending: false });
    if (!v) return;
    const withUnread = await Promise.all(v.map(async vv => {
      const { count } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('session_id', vv.session_id).eq('sender_type', 'user').eq('read', false);
      return { ...vv, unread: count || 0 };
    }));
    setVisitors(withUnread);
  }, []);

  useEffect(() => { loadVisitors(); const sub = supabase.channel('admin-visitors').on('postgres_changes', { event: '*', schema: 'public', table: 'visitors' }, loadVisitors).subscribe(); return () => { supabase.removeChannel(sub); }; }, [loadVisitors]);

  useEffect(() => {
    if (!selected) return;
    supabase.from('messages').select('*').eq('session_id', selected).order('created_at', { ascending: true }).then(({ data }) => setMessages(data || []));
    supabase.from('messages').update({ read: true }).eq('session_id', selected).eq('sender_type', 'user').eq('read', false).then(loadVisitors);
  }, [selected, loadVisitors]);

  useEffect(() => {
    if (!selected) return;
    const ch = supabase.channel('admin-chat-' + selected)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${selected}` }, (payload) => {
        const m = payload.new as Message;
        setMessages(prev => [...prev, m]);
        if (m.sender_type === 'user') supabase.from('messages').update({ read: true }).eq('id', m.id).then(loadVisitors);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `session_id=eq.${selected}` }, (payload) => {
        setMessages(prev => prev.map(mm => mm.id === payload.new.id ? payload.new as Message : mm));
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selected, loadVisitors]);

  useEffect(() => {
    if (!selected) return;
    const ch = supabase.channel('typing-' + selected)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'typing_status', filter: `session_id=eq.${selected}` }, (payload) => {
        setTyping(payload.new.is_typing ? selected : null);
      }).subscribe();
    supabase.from('typing_status').select('is_typing').eq('session_id', selected).single().then(({ data }) => { if (data?.is_typing) setTyping(selected); });
    return () => { supabase.removeChannel(ch); };
  }, [selected]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async (type: 'text' | 'image' | 'file') => {
    if (!selected) return;
    let content = '', image_url = '', file_url = '', file_name = '';
    if (type === 'text') { content = input.slice(0, 1000); if (!content.trim()) return; setInput(''); }
    else if (file) {
      const path = `admin/${selected}/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from('chat-assets').upload(path, file);
      if (error) { alert('上传失败'); return; }
      const { data } = supabase.storage.from('chat-assets').getPublicUrl(path);
      if (type === 'image') image_url = data.publicUrl;
      else { file_url = data.publicUrl; file_name = file.name; }
      setFile(null);
    }
    await supabase.from('messages').insert({ session_id: selected, sender_type: 'admin', admin_id: user.id, content, image_url, file_url, file_name });
  };

  const recall = async (id: number) => {
    const m = messages.find(mm => mm.id === id);
    if (!m || Date.now() - new Date(m.created_at).getTime() > 120000) return alert('超2分钟');
    await supabase.from('messages').update({ is_revoked: true }).eq('id', id);
  };

  const toggleBan = async (sessionId: string, action: 'ban' | 'unban') => {
    if (action === 'ban') await supabase.from('banned_visitors').upsert({ session_id: sessionId }, { onConflict: 'session_id' });
    else await supabase.from('banned_visitors').delete().eq('session_id', sessionId);
    loadVisitors();
  };

  const saveSettings = async () => {
    await supabase.from('admins').upsert({ id: user.id, ...adminInfo }, { onConflict: 'id' });
    setShowSettings(false);
  };

  const logout = async () => { await supabase.auth.signOut(); router.push('/admin'); window.location.reload(); };

  return (
    <div className="h-screen flex">
      <div className="w-80 border-r flex flex-col bg-gray-50">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            {adminInfo.logo_url ? <img src={adminInfo.logo_url} className="h-8 w-8 rounded" /> : <div className="h-8 w-8 bg-blue-500 rounded flex items-center justify-center text-white font-bold">{adminInfo.display_name[0] || 'C'}</div>}
            <span className="font-bold">{adminInfo.display_name}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowSettings(true)}><Settings size={18} /></button>
            <button onClick={logout}><LogOut size={18} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visitors.map(v => (
            <div key={v.session_id} onClick={() => setSelected(v.session_id)} className={`p-3 border-b cursor-pointer hover:bg-gray-100 flex justify-between items-center ${selected === v.session_id ? 'bg-blue-50' : ''}`}>
              <div>
                <div className="flex items-center gap-2"><Circle size={10} fill={v.is_online ? 'green' : 'gray'} color={v.is_online ? 'green' : 'gray'} /><span className="font-medium">{v.nickname || '访客'}</span></div>
                <div className="text-xs text-gray-500">{v.is_online ? '在线' : `离线 ${format(new Date(v.last_seen), 'MM-dd HH:mm')}`}</div>
              </div>
              {v.unread > 0 && <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">{v.unread}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-bold">{visitors.find(v => v.session_id === selected)?.nickname || '访客'} {typing === selected && <span className="text-sm text-green-500 ml-2">正在输入...</span>}</h3>
              <div>
                <button onClick={() => toggleBan(selected, 'ban')} className="text-red-500 mr-2"><UserX size={18} /></button>
                <button onClick={() => toggleBan(selected, 'unban')} className="text-green-600"><UserCheck size={18} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender_type === 'admin' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-lg ${msg.sender_type === 'admin' ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}>
                    {msg.is_revoked ? <span className="italic">消息已撤回</span> : (
                      <>
                        {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                        {msg.image_url && <img src={msg.image_url} className="max-w-full rounded cursor-pointer mt-2" onClick={() => window.open(msg.image_url)} />}
                        {msg.file_url && <a href={msg.file_url} download={msg.file_name} className="flex items-center gap-2 mt-2 underline"><Paperclip size={16} />{msg.file_name}</a>}
                      </>
                    )}
                    <div className="text-xs mt-1 opacity-70 flex justify-end gap-2">
                      {format(new Date(msg.created_at), 'HH:mm')}
                      {!msg.is_revoked && Date.now() - new Date(msg.created_at).getTime() < 120000 && (
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
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">选择一个访客开始聊天</div>
        )}
      </div>
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded shadow-lg w-96">
            <h2 className="text-xl font-bold mb-4">客服设置</h2>
            <label className="block mb-2">名称</label>
            <input className="border w-full p-2 rounded mb-4" value={adminInfo.display_name} onChange={e => setAdminInfo({ ...adminInfo, display_name: e.target.value })} />
            <label className="block mb-2">头像URL</label>
            <input className="border w-full p-2 rounded mb-4" value={adminInfo.avatar_url} onChange={e => setAdminInfo({ ...adminInfo, avatar_url: e.target.value })} />
            <label className="block mb-2">Logo URL</label>
            <input className="border w-full p-2 rounded mb-4" value={adminInfo.logo_url} onChange={e => setAdminInfo({ ...adminInfo, logo_url: e.target.value })} />
            <label className="block mb-2">欢迎语</label>
            <textarea className="border w-full p-2 rounded mb-4" value={adminInfo.welcome_message} onChange={e => setAdminInfo({ ...adminInfo, welcome_message: e.target.value })} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 border rounded">取消</button>
              <button onClick={saveSettings} className="px-4 py-2 bg-blue-500 text-white rounded">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}