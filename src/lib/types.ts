export type Status = 'online' | 'busy' | 'away' | 'offline'
export type Profile = {
  id: string
  username: string
  display_name: string
  bio: string
  avatar_path: string | null
  status: Status
}
export type Settings = {
  user_id: string
  theme: 'dark' | 'light'
  notifications: boolean
  soundboard_volume: number
}
export type Server = { id: string; name: string; owner_id: string; description: string }
export type Channel = {
  id: string
  server_id: string
  name: string
  kind: 'text' | 'voice'
  topic: string
  is_private: boolean
  archived: boolean
}
export type Conversation = { id: string; name: string; created_by: string }
export type Space = { id: string; kind: 'channel' | 'dm'; name: string; topic?: string }
export type Message = {
  id: string
  channel_id: string | null
  conversation_id: string | null
  author_id: string
  content: string
  reply_to: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}
export type Reaction = {
  id: string
  message_id: string
  user_id: string
  emoji: string
  active: boolean
  channel_id: string | null
  conversation_id: string | null
}
export type Attachment = {
  id: string
  message_id: string
  owner_id: string
  path: string
  name: string
  mime_type: string
  size: number
  ready: boolean
  channel_id: string | null
  conversation_id: string | null
}
export type Sound = {
  id: string
  owner_id: string
  name: string
  path: string
  mime_type: string
  size: number
  ready: boolean
}
export type Friendship = {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
}
export type Role = { id: string; server_id: string; name: string; color: string }
