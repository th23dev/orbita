import { useEffect, useRef, useState } from 'react'
import {
  File,
  Hash,
  Paperclip,
  Reply,
  Search,
  Send,
  Smile,
  Trash2,
  Pencil,
  X,
  Download,
  LoaderCircle,
  MessageCircle,
  Check,
  MoreHorizontal,
} from 'lucide-react'
import { check, db, errorText } from '../lib/supabase'
import { attachFile, bytes, safePreview, signedUrl, validateFile } from '../lib/files'
import type { Attachment, Message, Profile, Reaction, Space } from '../lib/types'
import { useChat } from '../hooks/useChat'
import { Avatar, Empty, IconButton } from './ui'
import { useDialogs } from './Dialogs'
import { insertMention, mentionQuery, normalizeMention } from '../lib/mentions'

function FileCard({ file, report }: { file: Attachment; report: (s: string) => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    if (safePreview(file.mime_type))
      signedUrl('attachments', file.path)
        .then((u) => {
          if (active) setUrl(u)
        })
        .catch((e) => report(errorText(e)))
    return () => {
      active = false
    }
  }, [file.path, file.mime_type, report])
  async function download() {
    try {
      const blob = check(await db().storage.from('attachments').download(file.path))
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = file.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 10000)
    } catch (e) {
      report(errorText(e))
    }
  }
  return (
    <div className="attachment">
      {url && file.mime_type.startsWith('image/') && (
        <img className="attachment-image" src={url} alt={file.name} loading="lazy" />
      )}
      {url && file.mime_type.startsWith('video/') && (
        <video src={url} controls preload="metadata" />
      )}
      {url && file.mime_type.startsWith('audio/') && <audio src={url} controls preload="none" />}
      <div className="file-meta">
        <File size={21} />
        <span>
          <strong>{file.name}</strong>
          <small>
            {bytes(file.size)} · {file.name.split('.').pop()?.toUpperCase()}
          </small>
        </span>
        <IconButton label={`Baixar ${file.name}`} onClick={() => void download()}>
          <Download size={18} />
        </IconButton>
      </div>
    </div>
  )
}

export function Chat({
  space,
  userId,
  profiles,
  mentionMembers,
  onRead,
  report,
  openProfile,
}: {
  space: Space
  userId: string
  profiles: Profile[]
  mentionMembers: Profile[]
  onRead: (channelId: string, timestamp: string) => void
  report: (s: string) => void
  openProfile: (profile: Profile) => void
}) {
  const dialogs = useDialogs()
  const chat = useChat(space, userId, report)
  const [parents, setParents] = useState<Record<string, Message>>({})
  const [context, setContext] = useState<Message[] | null>(null)
  const [contextAttachments, setContextAttachments] = useState<Attachment[]>([])
  const [contextReactions, setContextReactions] = useState<Reaction[]>([])
  const [highlight, setHighlight] = useState<string | null>(null)
  const [jumping, setJumping] = useState(false)
  const jumpSequence = useRef(0)
  const scopeKey = (space.conversationIds?.length ? space.conversationIds : [space.id]).join(',')
  const [actionFor, setActionFor] = useState<string | null>(null)
  const [content, setContent] = useState(''),
    [reply, setReply] = useState<Message | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [editText, setEditText] = useState('')
  const [pending, setPending] = useState<File[]>([]),
    [sending, setSending] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [emojiFor, setEmojiFor] = useState<string | null>(null)
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<Message[] | null>(null),
    [searching, setSearching] = useState(false),
    [drag, setDrag] = useState(false)
  const bottom = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true)
  const profile = (id: string) => profiles.find((p) => p.id === id)
  const markVisibleMessages = () => {
    const latest = chat.messages.at(-1)
    if (space.kind === 'channel' && !chat.loading && !context && results === null &&
      nearBottom.current && !document.hidden && document.hasFocus() && latest)
      onRead(space.id, latest.created_at)
  }
  useEffect(() => {
    markVisibleMessages()
    window.addEventListener('focus', markVisibleMessages)
    document.addEventListener('visibilitychange', markVisibleMessages)
    return () => {
      window.removeEventListener('focus', markVisibleMessages)
      document.removeEventListener('visibilitychange', markVisibleMessages)
    }
  }, [chat.messages, chat.loading, context, results, space.id, space.kind, onRead])
  const composer = useRef<HTMLTextAreaElement>(null)
  const [cursor, setCursor] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  const mention = space.kind === 'channel' && !mentionDismissed && !sending
    ? mentionQuery(content, cursor) : null
  const suggestions = mention ? mentionMembers.filter((member) =>
    normalizeMention(`${member.display_name} ${member.username}`).includes(normalizeMention(mention.query)),
  ).sort((a, b) => a.display_name.localeCompare(b.display_name, 'pt-BR')) : []
  const selectedMention = Math.min(mentionIndex, Math.max(0, suggestions.length - 1))
  useEffect(() => {
    document.getElementById(`mention-option-${selectedMention}`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedMention])
  function chooseMention(member: Profile) {
    if (!mention) return
    const next = insertMention(content, mention, member.username)
    if (next.text.length > 4000) return
    setContent(next.text)
    setCursor(next.cursor)
    setMentionDismissed(true)
    requestAnimationFrame(() => {
      composer.current?.focus()
      composer.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }
  function renderMentions(text: string) {
    if (space.kind !== 'channel') return text
    return text.split(/((?<![\w@])@[a-z0-9_]{3,32}\b)/g).map((part, index) => {
      const member = part.startsWith('@') && mentionMembers.find((p) => p.username === part.slice(1))
      return member ? <button type="button" className="message-mention" key={index}
        onClick={() => openProfile(member)}>{part}</button> : part
    })
  }
  const visibleMessages =
    context?.map((m) => chat.messages.find((current) => current.id === m.id) || m) ||
    results ||
    chat.messages
  useEffect(() => {
    if (!context) return
    let active = true
    const ids = context.map((m) => m.id)
    void (async () => {
      try {
        const [attachments, reactions] = await Promise.all([
          db().from('attachments').select('*').in('message_id', ids).eq('ready', true),
          db().from('message_reactions').select('*').in('message_id', ids).eq('active', true),
        ])
        const a = check(attachments) as Attachment[],
          r = check(reactions) as Reaction[]
        if (active) {
          setContextAttachments(a)
          setContextReactions(r)
        }
      } catch (e) {
        if (active) report(errorText(e))
      }
    })()
    return () => {
      active = false
    }
  }, [context, chat.attachments, chat.reactions, report])
  const parentIds = [
    ...new Set(visibleMessages.map((m) => m.reply_to).filter((id): id is string => !!id)),
  ]
    .sort()
    .join(',')
  useEffect(() => {
    if (!parentIds) return
    let active = true
    void (async () => {
      try {
        const rows = check(
          await db()
            .from('messages')
            .select('*')
            .in(space.kind === 'channel' ? 'channel_id' : 'conversation_id', scopeKey.split(','))
            .in('id', parentIds.split(',')),
        ) as Message[]
        if (active) setParents(Object.fromEntries(rows.map((m) => [m.id, m])))
      } catch (e) {
        if (active) report(errorText(e))
      }
    })()
    return () => {
      active = false
    }
  }, [parentIds, scopeKey, space.kind, report, chat.messages])
  useEffect(() => {
    if (!highlight) return
    const target = document.getElementById(`message-${highlight}`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target?.focus({ preventScroll: true })
    const timer = setTimeout(() => setHighlight(null), 3000)
    return () => clearTimeout(timer)
  }, [highlight, context, results])
  async function jump(id: string) {
    const sequence = ++jumpSequence.current
    nearBottom.current = false
    setJumping(true)
    try {
      if (!visibleMessages.some((m) => m.id === id)) {
        const messages = await chat.contextFor(id)
        if (sequence !== jumpSequence.current) return
        setContext(messages)
      }
      setHighlight(id)
    } catch (e) {
      report(errorText(e))
    } finally {
      if (sequence === jumpSequence.current) setJumping(false)
    }
  }
  useEffect(() => {
    if (nearBottom.current && !context) bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.messages.length, chat.attachments.length])
  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      setSearching(false)
      return
    }
    let active = true
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const data = check(
          await db()
            .from('messages')
            .select('*')
            .in(space.kind === 'channel' ? 'channel_id' : 'conversation_id', scopeKey.split(','))
            .is('deleted_at', null)
            .textSearch('search', query, { type: 'websearch', config: 'simple' })
            .order('created_at', { ascending: false })
            .limit(50),
        )
        if (active) setResults(data as Message[])
      } catch (e) {
        if (active) report(errorText(e))
      } finally {
        if (active) setSearching(false)
      }
    }, 350)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query, space.id, space.kind, scopeKey, report, chat.messages])
  const run = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (e) {
      report(errorText(e))
    }
  }
  function addFiles(files: FileList | null) {
    if (!files) return
    try {
      const next = Array.from(files)
      next.forEach((f) => validateFile(f))
      if (next.length + pending.length > 5)
        throw new Error('Envie no máximo cinco arquivos por mensagem.')
      setPending((old) => [...old, ...next])
    } catch (e) {
      report(errorText(e))
    }
  }
  async function send() {
    if (sending || (!content.trim() && !pending.length)) return
    composer.current?.focus({ preventScroll: true })
    setSending(true)
    try {
      const row = check(
        await db()
          .from('messages')
          .insert({
            author_id: userId,
            content: content.trim(),
            reply_to: reply?.id || null,
            [space.kind === 'channel' ? 'channel_id' : 'conversation_id']: space.id,
          })
          .select()
          .single(),
      ) as Message
      chat.merge([row])
      setContent('')
      setReply(null)
      setContext(null)
      setQuery('')
      nearBottom.current = true
      const failed: File[] = []
      for (const f of pending) {
        try {
          setProgress(0)
          await attachFile(f, row, setProgress)
        } catch (e) {
          failed.push(f)
          report(`${f.name}: ${errorText(e)}`)
        }
      }
      setPending(failed)
      setProgress(null)
      await chat.fetchRelated()
    } catch (e) {
      report(errorText(e))
    } finally {
      setSending(false)
      setProgress(null)
    }
  }
  async function react(message: Message, emoji: string) {
    const existing = check(
      await db()
        .from('message_reactions')
        .select('id,active')
        .eq('message_id', message.id)
        .eq('user_id', userId)
        .eq('emoji', emoji)
        .maybeSingle(),
    )
    if (existing)
      check(
        await db()
          .from('message_reactions')
          .update({ active: !existing.active })
          .eq('id', existing.id),
      )
    else
      check(
        await db()
          .from('message_reactions')
          .insert({ message_id: message.id, user_id: userId, emoji }),
      )
    setEmojiFor(null)
    await chat.fetchRelated()
  }
  return (
    <section
      className="chat-panel"
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        if (!sending) addFiles(e.dataTransfer.files)
      }}
    >
      <div className="chat-toolbar">
        <span className={`connection ${chat.connected ? 'connected' : ''}`}>
          <i />
          {chat.connected ? 'Em tempo real' : 'Conectando…'}
        </span>
        <label className="search-box">
          <Search size={15} />
          <input
            aria-label="Pesquisar mensagens"
            placeholder="Pesquisar nesta conversa"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setContext(null)
            }}
          />
          {query && (
            <IconButton label="Limpar pesquisa" onClick={() => setQuery('')}>
              <X size={14} />
            </IconButton>
          )}
        </label>
      </div>
      {context && (
        <div className="history-context">
          <span>Contexto da mensagem respondida</span>
          <button
            className="secondary"
            onClick={() => {
              jumpSequence.current++
              setContext(null)
              setHighlight(null)
              setQuery('')
              nearBottom.current = true
              requestAnimationFrame(() => bottom.current?.scrollIntoView())
            }}
          >
            Voltar às mensagens recentes
          </button>
        </div>
      )}
      {jumping && (
        <p role="status" className="center muted">
          Localizando mensagem original…
        </p>
      )}
      <div
        className="message-list"
        ref={scroller}
        onScroll={() => {
          const s = scroller.current
          if (s) nearBottom.current = s.scrollHeight - s.scrollTop - s.clientHeight < 130
          markVisibleMessages()
        }}
      >
        {results === null && !context && (
          <div className="channel-welcome">
            <div className="welcome-hash">
              {space.kind === 'channel' ? <Hash size={34} /> : <MessageCircle size={32} />}
            </div>
            <span className="eyebrow">TODO ENCONTRO COMEÇA COM UM OLÁ</span>
            <h1>{space.kind === 'channel' ? `Boas-vindas a #${space.name}` : space.name}</h1>
            <p>{space.topic || 'Este é o seu espaço. Puxe uma cadeira e comece a conversa.'}</p>
            <div className="welcome-rule">
              <span>O começo da conversa</span>
            </div>
          </div>
        )}
        {chat.loading && <p className="center muted">Carregando mensagens…</p>}
        {searching && <p className="center muted">Pesquisando…</p>}
        {results === null && !context && chat.more && chat.messages.length >= 50 && (
          <button className="secondary load-more" onClick={() => void run(chat.loadMore)}>
            Carregar mensagens anteriores
          </button>
        )}
        {results?.length === 0 && !searching && (
          <Empty icon={<Search />} title="Nenhuma mensagem encontrada">
            Tente outra palavra.
          </Empty>
        )}
        {visibleMessages.map((message) => {
          const author = profile(message.author_id),
            own = message.author_id === userId,
            reactions = (context ? contextReactions : chat.reactions).filter(
              (r) => r.message_id === message.id,
            ),
            parent =
              chat.messages.find((m) => m.id === message.reply_to) ||
              parents[message.reply_to || '']
          return (
            <article
              className={`message ${message.deleted_at ? 'deleted' : ''} ${actionFor === message.id ? 'actions-open' : ''} ${highlight === message.id ? 'message-highlight' : ''}`}
              key={message.id}
              id={`message-${message.id}`}
              tabIndex={-1}
            >
              <button
                className="profile-trigger"
                aria-label={`Ver perfil de ${author?.display_name || 'membro'}`}
                onClick={() => author && openProfile(author)}
              >
                <Avatar profile={author} />
              </button>
              <div className="message-body">
                <div className="message-meta">
                  <button className="profile-trigger" onClick={() => author && openProfile(author)}>
                    <strong>{author?.display_name || 'Membro'}</strong>
                  </button>
                  <time
                    dateTime={message.created_at}
                    title={new Date(message.created_at).toLocaleString('pt-BR')}
                  >
                    {new Date(message.created_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  {message.edited_at && !message.deleted_at && <small>editada</small>}
                </div>
                {message.reply_to && !message.deleted_at && (
                  <button
                    className="reply-preview"
                    onClick={() => void jump(message.reply_to!)}
                    aria-label={`Ir à mensagem de ${parent ? profile(parent.author_id)?.display_name || 'membro' : 'origem'}`}
                  >
                    <Reply size={13} />
                    <strong>
                      {parent
                        ? profile(parent.author_id)?.display_name || 'Membro'
                        : 'Mensagem anterior'}
                    </strong>
                    <span>
                      {parent?.deleted_at
                        ? 'Mensagem excluída'
                        : parent
                          ? parent.content?.slice(0, 140) || 'Anexo'
                          : 'Carregar mensagem original'}
                    </span>
                  </button>
                )}
                {editing === message.id ? (
                  <form
                    className="edit-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void run(async () => {
                        check(
                          await db()
                            .from('messages')
                            .update({ content: editText.trim() })
                            .eq('id', message.id),
                        )
                        setEditing(null)
                      })
                    }}
                  >
                    <input
                      autoFocus
                      required
                      maxLength={4000}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                    />
                    <IconButton label="Salvar edição" type="submit">
                      <Check size={17} />
                    </IconButton>
                    <IconButton label="Cancelar edição" onClick={() => setEditing(null)}>
                      <X size={17} />
                    </IconButton>
                  </form>
                ) : (
                  <p className="message-content">
                    {message.deleted_at ? 'Mensagem excluída' : renderMentions(message.content)}
                  </p>
                )}
                {!message.deleted_at && (
                  <>
                    {(context ? contextAttachments : chat.attachments)
                      .filter((a) => a.message_id === message.id)
                      .map((file) => (
                        <FileCard key={file.id} file={file} report={report} />
                      ))}
                    <div className="reactions">
                      {[...new Set(reactions.map((r) => r.emoji))].map((emoji) => (
                        <button
                          className={
                            reactions.some((r) => r.emoji === emoji && r.user_id === userId)
                              ? 'mine'
                              : ''
                          }
                          key={emoji}
                          onClick={() => void run(() => react(message, emoji))}
                        >
                          {emoji}
                          <span>{reactions.filter((r) => r.emoji === emoji).length}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {!message.deleted_at && (
                <>
                  <button
                    type="button"
                    className="message-more"
                    aria-label="Opções da mensagem"
                    aria-expanded={actionFor === message.id}
                    onClick={() => setActionFor(actionFor === message.id ? null : message.id)}
                  >
                    <MoreHorizontal size={20} />
                  </button>
                  <div className="message-actions">
                    <IconButton
                      label="Reagir"
                      onClick={() => setEmojiFor(emojiFor === message.id ? null : message.id)}
                    >
                      <Smile size={16} />
                    </IconButton>
                    <IconButton label="Responder" onClick={() => setReply(message)}>
                      <Reply size={16} />
                    </IconButton>
                    {own && (
                      <>
                        <IconButton
                          label="Editar mensagem"
                          onClick={() => {
                            setEditing(message.id)
                            setEditText(message.content)
                          }}
                        >
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton
                          label="Excluir mensagem"
                          onClick={async () => {
                            if (
                              await dialogs.confirm({
                                title: 'Excluir mensagem?',
                                message: 'O conteúdo será removido para todos nesta conversa.',
                                confirm: 'Excluir',
                                danger: true,
                              })
                            )
                              void run(async () => {
                                check(
                                  await db()
                                    .from('messages')
                                    .update({ deleted_at: new Date().toISOString() })
                                    .eq('id', message.id),
                                )
                              })
                          }}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </>
                    )}
                    {emojiFor === message.id && (
                      <div className="emoji-menu">
                        {['👍', '❤️', '😂', '🎉', '🔥', '👀'].map((emoji) => (
                          <button key={emoji} onClick={() => void run(() => react(message, emoji))}>
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </article>
          )
        })}
        <div ref={bottom} />
      </div>
      <div className="composer-wrap">
        {reply && (
          <div className="reply-composer">
            <Reply size={15} />
            <span>
              Respondendo a <strong>{profile(reply.author_id)?.display_name}</strong>:{' '}
              {reply.content.slice(0, 90)}
            </span>
            <IconButton label="Cancelar resposta" onClick={() => setReply(null)}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        {pending.length > 0 && (
          <div className="pending-files">
            {pending.map((f, i) => (
              <span key={`${f.name}-${i}`}>
                <File size={15} />
                {f.name}
                <button
                  disabled={sending}
                  aria-label={`Remover ${f.name}`}
                  onClick={() => setPending((old) => old.filter((_, n) => n !== i))}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        )}
        {progress !== null && (
          <div className="upload-progress">
            <progress value={progress} max={100} />
            <small>
              {progress}% enviado{progress === 100 ? ' · Processando…' : ''}
            </small>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          {mention && (
            <div className="mention-menu" id="mention-suggestions" role="listbox" aria-label="Membros do servidor">
              {suggestions.length ? suggestions.map((member, index) => (
                <button type="button" role="option" aria-selected={index === selectedMention}
                  id={`mention-option-${index}`} key={member.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseMention(member)}>
                  <Avatar profile={member} small />
                  <span><strong>{member.display_name}</strong><small>@{member.username}</small></span>
                </button>
              )) : <p role="status">Nenhum membro encontrado.</p>}
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <IconButton
            label="Anexar arquivos"
            disabled={sending}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={21} />
          </IconButton>
          <textarea
            ref={composer}
            aria-autocomplete="list"
            aria-controls={mention ? 'mention-suggestions' : undefined}
            aria-activedescendant={mention && suggestions.length ? `mention-option-${selectedMention}` : undefined}
            onBlur={() => setMentionDismissed(true)}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
            aria-label="Mensagem"
            placeholder={`Converse em ${space.kind === 'channel' ? '#' : ''}${space.name}`}
            maxLength={4000}
            value={content}
            readOnly={sending}
            aria-busy={sending}
            rows={1}
            onChange={(e) => {
              setContent(e.target.value)
              setCursor(e.target.selectionStart)
              setMentionIndex(0)
              setMentionDismissed(false)
              chat.sendTyping()
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (mention) {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setMentionDismissed(true)
                  return
                }
                if (suggestions.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key) && !e.shiftKey) {
                  e.preventDefault()
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp')
                    setMentionIndex((selectedMention + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
                  else chooseMention(suggestions[selectedMention])
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button
            className="send-button"
            aria-label="Enviar mensagem"
            disabled={sending || (!content.trim() && !pending.length)}
          >
            {sending ? <LoaderCircle size={19} className="spin" /> : <Send size={19} />}
          </button>
        </form>
        <div className="composer-hint">
          <span>
            {chat.typing.length
              ? `${chat.typing.map((id) => profile(id)?.display_name || 'Alguém').join(', ')} digitando…`
              : 'Boas conversas começam aqui.'}
          </span>
          <span>Enter para enviar · Shift + Enter para nova linha</span>
        </div>
      </div>
      {drag && (
        <div className="drop-overlay">
          <Paperclip size={40} />
          <h2>Solte seus arquivos aqui</h2>
          <p>Até 25 MB por arquivo</p>
        </div>
      )}
    </section>
  )
}
