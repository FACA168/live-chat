'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Send, Paperclip, LogOut, Settings, UserX, UserCheck, Circle, Search, Bell, User, UploadCloud } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import type { Visitor, Message, AdminInfo } from '@/types';

const bluePalette = ['bg-blue-500', 'bg-blue-600', 'bg-indigo-500', 'bg-cyan-500', 'bg-sky-500'];

export default function AdminPage() {
  const supabase = getSupabase();
  const router = useRouter();
  const [user, setUser] = useState<any>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setUser(null);
        return;
      }
      setUser(user);
    };
    checkAuth();
  }, [supabase.auth]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setLoginError('登录失败，请检查邮箱和密码');
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    } catch (e) {
      setLoginError('网络异常，请稍后重试');
    }
  };

  if (user === undefined) return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">加载中...</div>;

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-xl w-96 border border-blue-100">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
              <User size={32} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">客服工作台</h1>
            <p className="text-gray-500 text-sm mt-1">登录进入在线客服系统</p>
          </div>
          {loginError && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm border border-red-100">{loginError}</div>}
          <input type="email" className="border border-gray-200 w-full p-3 mb-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all" placeholder="管理员邮箱" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" className="border border-gray-200 w-full p-3 mb-6 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} required />
          <button type="submit" className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3 rounded-xl hover:shadow-lg hover:shadow-blue-200 transition-all font-medium">登录</button>
        </form>
      </div>
    );
  }

  return <AdminPanel user={user} />;
}

function AdminPanel({ user }: { user: any }) {
  const supabase = getSupabase();
  const router = useRouter();
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [adminInfo, setAdminInfo] = useState<AdminInfo>({
    display_name: '客服', avatar_url: '', welcome_message: '您好，有什么可以帮您？', logo_url: ''
  });
  const [showSettings, setShowSettings] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadAdminInfo = async () => {
      try {
        const { data } = await supabase.from('admins').select('*').eq('id', user.id).single();
        if (data) setAdminInfo(data);
      } catch (e) {}
    };
    loadAdminInfo();
  }, [user.id, supabase]);

  const loadVisitors = useCallback(async () => {
    try {
      const { data: v } = await supabase.from('visitors').select('*').order('is_online', { ascending: false }).order('last_seen', { ascending: false });
      if (!v) return;

      const sessionIds = v.map(item => item.session_id);
      const { data: unreadCounts } = await supabase
        .from('messages')
        .select('session_id, count')
        .eq('sender_type', 'user')
        .eq('read', false)
        .in('session_id', sessionIds)
        .select('session_id')
        .limit(1000);

      const countMap: Record<string, number> = {};
      unreadCounts?.forEach(item => {
        countMap[item.session_id] = (countMap[item.session_id] || 0) + 1;
      });

      const withUnread = v.map((vv, idx) => ({
        ...vv,
        unread: countMap[vv.session_id] || 0,
        avatar_color: bluePalette[idx % bluePalette.length]
      }));
      setVisitors(withUnread);
    } catch (e) {
      console.error('加载访客列表失败', e);
    }
  }, [supabase]);

  useEffect(() => {
    loadVisitors();
    const sub = supabase.channel('admin-visitors').on('postgres_changes', { event: '*', schema: 'public', table: 'visitors' }, loadVisitors).subscribe();
    return () => { supabase.removeAllChannels(); };
  }, [loadVisitors, supabase]);

  useEffect(() => {
    if (!selected) return;
    const loadChat = async () => {
      try {
        const { data } = await supabase.from('messages').select('*').eq('session_id', selected).order('created_at', { ascending: true });
        setMessages(data || []);
        await supabase.from('messages').update({ read: true }).eq('session_id', selected).eq('sender_type', 'user').eq('read', false);
        loadVisitors();
      } catch (e) {}
    };
    loadChat();
  }, [selected, loadVisitors, supabase]);

  useEffect(() => {
    if (!selected) return;
    const ch = supabase.channel('admin-chat-' + selected)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${selected}` }, async (payload) => {
        const m = payload.new as Message;
        setMessages(prev => [...prev, m]);
        if (m.sender_type === 'user') {
          await supabase.from('messages').update({ read: true }).eq('id', m.id);
          loadVisitors();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `session_id=eq.${selected}` }, (payload) => {
        setMessages(prev => prev.map(mm => mm.id === payload.new.id ? payload.new as Message : mm));
      }).subscribe();
    return () => { supabase.removeAllChannels(); };
  }, [selected, loadVisitors, supabase]);

  useEffect(() => {
    if (!selected) return;
    const ch = supabase.channel('typing-' + selected)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'typing_status', filter: `session_id=eq.${selected}` }, (payload) => {
        setTyping(payload.new.is_typing ? selected : null);
      }).subscribe();
    supabase.from('typing_status').select('is_typing').eq('session_id', selected).single().then(({ data }) => { if (data?.is_typing) setTyping(selected); });
    return () => { supabase.removeAllChannels(); };
  }, [selected, supabase]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = useCallback(async (type: 'text' | 'image' | 'file') => {
    if (!selected || isSending) return;
    setIsSending(true);
    setUploadProgress(0);

    try {
      let content = '', image_url = '', file_url = '', file_name = '';
      if (type === 'text') {
        content = input.slice(0, 1000);
        if (!content.trim()) { setIsSending(false); return; }
        setInput('');
      } else if (file) {
        if (file.size > 10 * 1024 * 1024) {
          alert('文件大小不能超过10MB');
          setIsSending(false);
          return;
        }
        const path = `admin/${selected}/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from('chat-assets').upload(path, file, {
          onUploadProgress: (event) => {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });
        if (error) { alert('上传失败：' + error.message); setIsSending(false); return; }
        const { data } = supabase.storage.from('chat-assets').getPublicUrl(path);
        if (type === 'image') image_url = data.publicUrl;
        else { file_url = data.publicUrl; file_name = file.name; }
        setFile(null);
      }
      await supabase.from('messages').insert({ session_id: selected, sender_type: 'admin', admin_id: user.id, content, image_url, file_url, file_name });
    } catch (e) {
      console.error('发送失败', e);
      alert('网络异常，请稍后重试');
    } finally {
      setIsSending(false);
      setUploadProgress(0);
    }
  }, [selected, input, file, isSending, user.id, supabase]);

  const recall = useCallback(async (id: number) => {
    const m = messages.find(mm => mm.id === id);
    if (!m || Date.now() - new Date(m.created_at).getTime() > 120000) {
      alert('超过2分钟无法撤回');
      return;
    }
    try {
      await supabase.from('messages').update({ is_revoked: true }).eq('id', id);
    } catch (e) {}
  }, [messages, supabase]);

  const toggleBan = useCallback(async (sessionId: string, action: 'ban' | 'unban') => {
    try {
      if (action === 'ban') await supabase.from('banned_visitors').upsert({ session_id: sessionId }, { onConflict: 'session_id' });
      else await supabase.from('banned_visitors').delete().eq('session_id', sessionId);
      loadVisitors();
    } catch (e) {
      alert('操作失败');
    }
  }, [loadVisitors, supabase]);

  const saveSettings = useCallback(async () => {
    try {
      await supabase.from('admins').upsert({ id: user.id, ...adminInfo }, { onConflict: 'id' });
      setShowSettings(false);
    } catch (e) {
      alert('保存失败');
    }
  }, [user.id, adminInfo, supabase]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push('/admin');
  }, [router, supabase.auth]);

  const filteredVisitors = visitors.filter(v =>
    (v.nickname || '访客').toLowerCase().includes(searchKeyword.toLowerCase())
  );

  return (
    <div className="h-screen flex bg-gray-50">
      <div className="w-80 border-r border-blue-50 bg-white flex flex-col">
        <div className="p-4 border-b border-blue-50 bg-gradient-to-r from-blue-50 to-white">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-lg">
              {adminInfo.display_name[0] || 'C'}
            </div>
            <div>
              <span className="font-bold text-gray-800 block">{adminInfo.display_name}</span>
              <span className="text-xs text-gray-500">在线客服系统</span>
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-blue-50 rounded-lg text-gray-500 transition-colors"><Settings size={18} /></button>
              <button onClick={logout} className="p-2 hover:bg-blue-50 rounded-lg text-gray-500 transition-colors"><LogOut size={18} /></button>
            </div>
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-all"
              placeholder="搜索访客..."
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredVisitors.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">暂无访客</div>
          ) : filteredVisitors.map(v => (
            <div
              key={v.session_id}
              onClick={() => setSelected(v.session_id)}
              className={`p-3 border-b border-gray-50 cursor-pointer hover:bg-blue-50 flex justify-between items-center transition-all ${selected === v.session_id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className={`h-10 w-10 ${v.avatar_color} rounded-xl flex items-center justify-center text-white font-medium text-sm`}>
                    {(v.nickname || '访客')[0] || '访'}
                  </div>
                  <Circle
                    size={12}
                    fill={v.is_online ? '#22c55e' : '#9ca3af'}
                    color="white"
                    className="absolute -bottom-0.5 -right-0.5"
                  />
                </div>
                <div>
                  <span className="font-medium text-gray-700 block text-sm">{v.nickname || '访客'}</span>
                  <span className="text-xs text-gray-500">
                    {v.is_online ? '在线' : `离线 ${format(new Date(v.last_seen), 'MM-dd HH:mm')}`}
                  </span>
                </div>
              </div>
              {v.unread > 0 && (
                <span className="bg-gradient-to-r from-blue-500 to-blue-600 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px] text-center">
                  {v.unread}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="p-4 border-b border-gray-100 bg-white flex justify-between items-center shadow-sm">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-blue-500 rounded-xl flex items-center justify-center text-white font-medium">
                  {(visitors.find(v => v.session_id === selected)?.nickname || '访客')[0] || '访'}
                </div>
                <div>
                  <h3 className="font-bold text-gray-800">
                    {visitors.find(v => v.session_id === selected)?.nickname || '访客'}
                  </h3>
                  {typing === selected && <span className="text-sm text-blue-500">正在输入...</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleBan(selected, 'ban')} className="p-2 hover:bg-red-50 rounded-lg text-red-500 transition-colors" title="拉黑访客"><UserX size={18} /></button>
                <button onClick={() => toggleBan(selected, 'unban')} className="p-2 hover:bg-green-50 rounded-lg text-green-600 transition-colors" title="解除拉黑"><UserCheck size={18} /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gradient-to-b from-gray-50 to-blue-50/30">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender_type === 'admin' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] p-3.5 rounded-2xl ${
                    msg.sender_type === 'admin'
                      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-br-md shadow-lg shadow-blue-200'
                      : 'bg-white shadow-sm border border-gray-100 rounded-bl-md'
                  }`}>
                    {msg.is_revoked ? (
                      <span className="italic opacity-60 text-sm">消息已撤回</span>
                    ) : (
                      <>
                        {msg.content && <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>}
                        {msg.image_url && <img src={msg.image_url} className="max-w-full rounded-lg cursor-pointer mt-2" onClick={() => window.open(msg.image_url)} alt="图片消息" />}
                        {msg.file_url && (
                          <a href={msg.file_url} download={msg.file_name} className={`flex items-center gap-2 mt-2 underline text-sm ${msg.sender_type === 'admin' ? 'text-blue-100' : 'text-blue-600'}`}>
                            <Paperclip size={16} />{msg.file_name}
                          </a>
                        )}
                      </>
                    )}
                    <div className={`text-xs mt-2 flex justify-end gap-2 ${msg.sender_type === 'admin' ? 'text-blue-100' : 'text-gray-400'}`}>
                      {format(new Date(msg.created_at), 'HH:mm')}
                      {!msg.is_revoked && Date.now() - new Date(msg.created_at).getTime() < 120000 && (
                        <button onClick={() => recall(msg.id)} className="hover:opacity-80">撤回</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {isSending && uploadProgress > 0 && uploadProgress < 100 && (
                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100 max-w-[70%] ml-auto">
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

            <div className="border-t border-gray-100 bg-white p-4 flex items-center gap-3">
              <input type="file" ref={fileInputRef} hidden accept="image/*,.pdf,.doc,.docx,.zip" onChange={e => setFile(e.target.files?.[0] || null)} />
              <button onClick={() => fileInputRef.current?.click()} disabled={isSending} className="p-2.5 hover:bg-blue-50 rounded-xl text-gray-500 transition-all disabled:opacity-50">
                <Paperclip size={20} />
              </button>
              <input
                className="flex-1 border border-gray-200 rounded-full px-5 py-3 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-all"
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
                className="p-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-full disabled:opacity-50 hover:shadow-lg hover:shadow-blue-200 transition-all"
              >
                <Send size={20} />
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <div className="w-24 h-24 bg-blue-50 rounded-3xl flex items-center justify-center mb-4">
              <Bell size={40} className="text-blue-300" />
            </div>
            <p className="text-lg font-medium text-gray-500">选择一个访客开始聊天</p>
            <p className="text-sm text-gray-400 mt-1">访客发起对话后将自动显示在左侧列表</p>
          </div>
        )}
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-[420px] border border-blue-100">
            <h2 className="text-xl font-bold mb-6 text-gray-800">客服设置</h2>
            <label className="block mb-2 text-sm font-medium text-gray-700">客服名称</label>
            <input className="border border-gray-200 w-full p-3 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-all" value={adminInfo.display_name} onChange={e => setAdminInfo({ ...adminInfo, display_name: e.target.value })} />
            <label className="block mb-2 text-sm font-medium text-gray-700">头像URL</label>
            <input className="border border-gray-200 w-full p-3 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-all" value={adminInfo.avatar_url} onChange={e => setAdminInfo({ ...adminInfo, avatar_url: e.target.value })} />
            <label className="block mb-2 text-sm font-medium text-gray-700">Logo URL</label>
            <input className="border border-gray-200 w-full p-3 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-all" value={adminInfo.logo_url} onChange={e => setAdminInfo({ ...adminInfo, logo_url: e.target.value })} />
            <label className="block mb-2 text-sm font-medium text-gray-700">欢迎语</label>
            <textarea className="border border-gray-200 w-full p-3 rounded-xl mb-6 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-all resize-none h-24" value={adminInfo.welcome_message} onChange={e => setAdminInfo({ ...adminInfo, welcome_message: e.target.value })} />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowSettings(false)} className="px-5 py-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors">取消</button>
              <button onClick={saveSettings} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:shadow-lg hover:shadow-blue-200 transition-all">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}