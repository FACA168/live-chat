export type Message = {
  id: number;
  session_id: string;
  sender_type: 'user' | 'admin';
  admin_id?: string;
  content?: string;
  image_url?: string;
  file_url?: string;
  file_name?: string;
  is_revoked: boolean;
  read?: boolean;
  created_at: string;
};

export type Visitor = {
  session_id: string;
  nickname: string;
  is_online: boolean;
  last_seen: string;
  unread: number;
  avatar_color: string;
};

export type AdminInfo = {
  display_name: string;
  avatar_url: string;
  welcome_message: string;
  logo_url: string;
};
