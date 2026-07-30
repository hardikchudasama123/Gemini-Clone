import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Composer from './components/Composer.jsx';
import Message from './components/Message.jsx';
import ModelPicker from './components/ModelPicker.jsx';
import Sidebar from './components/Sidebar.jsx';
import UserMenu from './components/UserMenu.jsx';
import Welcome from './components/Welcome.jsx';
import { Icon } from './components/Icons.jsx';
import { SessionExpiredError, fetchModels, fetchTitle, streamChat } from './lib/api.js';
import { createDb } from './lib/db.js';
import {
  createDraftChat,
  loadPrefs,
  savePrefs,
  toGeminiContents,
  uid,
} from './lib/store.js';

// Only used if /api/models fails; mirrors the server's own default model so a
// send still reaches something rather than a model id the server may not serve.
const FALLBACK_MODELS = [
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT-OSS 120B',
    blurb: 'Strong reasoning, very fast',
    thinking: true,
    tier: 'pro',
  },
];

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function emptyAssistant(seq) {
  return {
    id: uid(),
    seq,
    role: 'model',
    text: '',
    thought: '',
    images: [],
    sources: [],
    parts: [],
    createdAt: Date.now(),
  };
}

export default function Chat({ supabase, session, user, onSignOut }) {
  const prefs = useRef(loadPrefs()).current;

  const [models, setModels] = useState(FALLBACK_MODELS);
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [streamingId, setStreamingId] = useState(null);
  const [booting, setBooting] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1100);
  const [theme, setTheme] = useState(prefs.theme || 'dark');
  const [searchGrounding, setSearchGrounding] = useState(Boolean(prefs.searchGrounding));
  const [seed, setSeed] = useState({ text: '', nonce: 0 });
  const [toast, setToast] = useState(null);

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const pinnedRef = useRef(true);
  const greeting = useRef(greetingForNow()).current;

  const db = useMemo(() => createDb(supabase, user.id), [supabase, user.id]);

  /**
   * Always read the token straight from Supabase so a refresh mid-session
   * cannot leave us sending a stale one.
   */
  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || session?.access_token || '';
  }, [supabase, session]);

  const handleFailure = useCallback(
    (error, fallback) => {
      if (error instanceof SessionExpiredError) {
        onSignOut();
        return;
      }
      setToast(error?.message || fallback);
    },
    [onSignOut],
  );

  /* ------------------------------------------------------------- bootstrap */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const [modelResult, chatResult] = await Promise.allSettled([
          fetchModels(token),
          db.listChats(),
        ]);
        if (cancelled) return;

        let defaultModel = prefs.model || FALLBACK_MODELS[0].id;
        if (modelResult.status === 'fulfilled' && modelResult.value.models?.length) {
          setModels(modelResult.value.models);
          defaultModel = prefs.model || modelResult.value.defaultModel;
        } else if (modelResult.reason instanceof SessionExpiredError) {
          onSignOut();
          return;
        }

        if (chatResult.status === 'fulfilled') {
          const existing = chatResult.value;
          if (existing.length) {
            setChats(existing);
            setActiveId(existing[0].id);
          } else {
            const draft = createDraftChat(defaultModel);
            setChats([draft]);
            setActiveId(draft.id);
          }
        } else {
          setToast(chatResult.reason?.message || 'Could not load your chats.');
          const draft = createDraftChat(defaultModel);
          setChats([draft]);
          setActiveId(draft.id);
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, getToken, onSignOut, prefs.model]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    savePrefs({ theme, searchGrounding, model: chats.find((c) => c.id === activeId)?.model });
  }, [theme, searchGrounding, chats, activeId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeId) || null,
    [chats, activeId],
  );
  const activeModel = useMemo(
    () => models.find((m) => m.id === activeChat?.model) || models[0],
    [models, activeChat],
  );

  /* ------------------------------------------------------- message loading */

  /**
   * Fetching is driven by which chat is active, not by the click that made it
   * active. Bootstrap selects a chat without anyone clicking it, so hanging
   * this off the click handler alone left that chat on `loaded: false` — a
   * spinner that never resolved, and a thread whose history was invisible to
   * the next message it sent.
   */
  const loadingRef = useRef(new Set());

  const loadMessagesFor = useCallback(
    async (chatId) => {
      if (loadingRef.current.has(chatId)) return;
      loadingRef.current.add(chatId);
      try {
        const messages = await db.loadMessages(chatId);
        setChats((prev) =>
          prev.map((c) => (c.id === chatId ? { ...c, messages, loaded: true } : c)),
        );
      } catch (error) {
        // Still mark it loaded: an empty thread plus an explanatory toast is a
        // better failure than a spinner that spins forever.
        setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, loaded: true } : c)));
        handleFailure(error, 'Could not open that chat.');
      } finally {
        loadingRef.current.delete(chatId);
      }
    },
    [db, handleFailure],
  );

  // Primitives, not the chat object: `activeChat` gets a new identity on every
  // patch, which would re-run this on each streamed token.
  const activeChatId = activeChat?.id ?? null;
  const activeChatLoaded = activeChat?.loaded ?? true;
  const activeChatPersisted = activeChat?.persisted ?? false;

  useEffect(() => {
    if (!activeChatId || activeChatLoaded || !activeChatPersisted) return;
    loadMessagesFor(activeChatId);
  }, [activeChatId, activeChatLoaded, activeChatPersisted, loadMessagesFor]);

  /* ----------------------------------------------------------- scrolling */

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (pinnedRef.current) scrollToBottom(streamingId ? 'auto' : 'smooth');
  }, [activeChat?.messages, streamingId, scrollToBottom]);

  useEffect(() => {
    pinnedRef.current = true;
    scrollToBottom('auto');
  }, [activeId, scrollToBottom]);

  /* -------------------------------------------------------- chat mutation */

  const patchChat = useCallback((chatId, patch) => {
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId ? { ...chat, ...patch, updatedAt: Date.now() } : chat,
      ),
    );
  }, []);

  const patchMessage = useCallback((chatId, messageId, patch) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;
        return {
          ...chat,
          messages: chat.messages.map((message) =>
            message.id === messageId ? { ...message, ...patch } : message,
          ),
        };
      }),
    );
  }, []);

  /**
   * Create the row lazily, the first time a draft chat is actually used.
   * Temporary chats are never given a row at all.
   */
  const ensurePersisted = useCallback(
    async (chat) => {
      if (chat.persisted || chat.temporary) return;
      await db.createChat({ id: chat.id, model: chat.model, title: chat.title });
      patchChat(chat.id, { persisted: true });
    },
    [db, patchChat],
  );

  /* ------------------------------------------------------------ streaming */

  const runStream = useCallback(
    async (chatId, contents, modelId, assistant, temporary = false) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStreamingId(assistant.id);

      const acc = {
        text: '',
        thought: '',
        images: [],
        sources: [],
        parts: [],
        usage: null,
        error: null,
      };

      let queued = false;
      const flush = () => {
        queued = false;
        patchMessage(chatId, assistant.id, {
          text: acc.text,
          thought: acc.thought,
          images: acc.images,
          sources: acc.sources,
        });
      };
      const schedule = () => {
        if (queued) return;
        queued = true;
        window.requestAnimationFrame(flush);
      };

      let expired = false;

      try {
        const token = await getToken();
        await streamChat(
          { model: modelId, messages: contents, searchGrounding, token },
          (event) => {
            switch (event.type) {
              case 'text':
                acc.text += event.text;
                schedule();
                break;
              case 'thought':
                acc.thought += event.text;
                schedule();
                break;
              case 'image':
                acc.images = [...acc.images, { mimeType: event.mimeType, data: event.data }];
                schedule();
                break;
              case 'sources':
                acc.sources = [...acc.sources, ...event.items];
                schedule();
                break;
              case 'usage':
                acc.usage = event;
                break;
              case 'done':
                acc.parts = event.parts || [];
                break;
              case 'error':
                acc.error = event.message;
                break;
              default:
                break;
            }
          },
          controller.signal,
        );
      } catch (error) {
        if (error?.name === 'AbortError') {
          acc.text = acc.text || '_Stopped._';
        } else if (error instanceof SessionExpiredError) {
          expired = true;
        } else {
          acc.error = error?.message || 'Something went wrong.';
        }
      } finally {
        const finished = {
          ...assistant,
          text: acc.text,
          thought: acc.thought,
          images: acc.images,
          sources: acc.sources,
          usage: acc.usage,
          parts: acc.parts.length ? acc.parts : acc.text ? [{ text: acc.text }] : [],
          error: acc.error,
        };
        patchMessage(chatId, assistant.id, finished);
        abortRef.current = null;
        setStreamingId(null);

        if (expired) {
          onSignOut();
        } else if (!temporary) {
          // Persist once the turn has settled rather than on every token.
          try {
            const stored = await db.saveMessage(chatId, finished);
            patchMessage(chatId, assistant.id, {
              images: finished.images.map((image, i) => ({
                ...image,
                path: stored.images[i]?.path,
              })),
            });
          } catch (error) {
            setToast(`Reply was not saved — ${error.message}`);
          }
        }
      }
    },
    [db, getToken, onSignOut, patchMessage, searchGrounding],
  );

  const maybeTitle = useCallback(
    async (chat, userText) => {
      // A temporary chat has no sidebar entry, so a generated title is wasted.
      if (chat.temporary || chat.titleLocked || chat.messages.length > 0 || !userText) return;
      const token = await getToken();
      const title = await fetchTitle(userText, token);
      if (!title) return;
      patchChat(chat.id, { title });
      try {
        await db.updateChat(chat.id, { title });
      } catch {
        /* a missing title is not worth interrupting the chat for */
      }
    },
    [db, getToken, patchChat],
  );

  /* -------------------------------------------------------------- actions */

  const handleSend = useCallback(
    async ({ text, attachments }) => {
      const chat = activeChat;
      if (!chat) return;

      const baseSeq = chat.messages.length;
      const userMessage = {
        id: uid(),
        seq: baseSeq,
        role: 'user',
        text,
        attachments,
        images: [],
        sources: [],
        parts: [],
        createdAt: Date.now(),
      };
      const assistant = emptyAssistant(baseSeq + 1);

      const history = [...chat.messages, userMessage];
      const contents = toGeminiContents(history);

      patchChat(chat.id, { messages: [...history, assistant] });
      pinnedRef.current = true;
      maybeTitle(chat, text);

      if (!chat.temporary) {
        try {
          await ensurePersisted(chat);
          const stored = await db.saveMessage(chat.id, userMessage);
          // Swap base64 for storage paths so a later reload finds the media.
          patchMessage(chat.id, userMessage.id, { attachments: stored.attachments });
        } catch (error) {
          handleFailure(error, 'Could not save your message.');
        }
      }

      runStream(chat.id, contents, chat.model, assistant, chat.temporary);
    },
    [
      activeChat,
      db,
      ensurePersisted,
      handleFailure,
      maybeTitle,
      patchChat,
      patchMessage,
      runStream,
    ],
  );

  const handleRegenerate = useCallback(
    async (messageId) => {
      const chat = activeChat;
      if (!chat || streamingId) return;

      const index = chat.messages.findIndex((m) => m.id === messageId);
      if (index < 1) return;

      const history = chat.messages.slice(0, index);
      const assistant = emptyAssistant(index);

      patchChat(chat.id, { messages: [...history, assistant] });
      pinnedRef.current = true;

      if (!chat.temporary) {
        try {
          await db.deleteMessagesFrom(chat.id, index);
        } catch (error) {
          handleFailure(error, 'Could not clear the previous reply.');
        }
      }

      runStream(chat.id, toGeminiContents(history), chat.model, assistant, chat.temporary);
    },
    [activeChat, db, handleFailure, patchChat, runStream, streamingId],
  );

  const handleEdit = useCallback(
    async (messageId) => {
      const chat = activeChat;
      if (!chat || streamingId) return;

      const index = chat.messages.findIndex((m) => m.id === messageId);
      if (index === -1) return;

      const target = chat.messages[index];
      patchChat(chat.id, { messages: chat.messages.slice(0, index) });
      setSeed((prev) => ({ text: target.text || '', nonce: prev.nonce + 1 }));

      if (chat.temporary) return;
      try {
        await db.deleteMessagesFrom(chat.id, index);
      } catch (error) {
        handleFailure(error, 'Could not remove the old messages.');
      }
    },
    [activeChat, db, handleFailure, patchChat, streamingId],
  );

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    const model = activeChat?.model || models[0]?.id || FALLBACK_MODELS[0].id;
    const draft = createDraftChat(model);
    // Discard any unused draft so the sidebar never accumulates empty chats.
    setChats((prev) => [draft, ...prev.filter((c) => c.persisted)]);
    setActiveId(draft.id);
    if (window.innerWidth < 1100) setSidebarOpen(false);
  }, [activeChat, models]);

  /**
   * Toggle temporary mode. Entering starts a throwaway chat; leaving returns to
   * a normal draft. Either way the current unsaved chat is discarded.
   */
  const handleToggleTemporary = useCallback(() => {
    abortRef.current?.abort();
    const model = activeChat?.model || models[0]?.id || FALLBACK_MODELS[0].id;
    const draft = createDraftChat(model, { temporary: !activeChat?.temporary });
    setChats((prev) => [draft, ...prev.filter((c) => c.persisted)]);
    setActiveId(draft.id);
    if (window.innerWidth < 1100) setSidebarOpen(false);
  }, [activeChat, models]);

  const handleSelectChat = useCallback(
    (chatId) => {
      if (chatId === activeId) return;
      abortRef.current?.abort();
      setChats((prev) => prev.filter((c) => c.id === chatId || c.persisted));
      setActiveId(chatId);
      if (window.innerWidth < 1100) setSidebarOpen(false);
      // Messages are fetched by the effect above, which covers this selection
      // and the one bootstrap makes on load.
    },
    [activeId],
  );

  const handleDeleteChat = useCallback(
    async (chatId) => {
      if (chatId === activeId) abortRef.current?.abort();
      const target = chats.find((c) => c.id === chatId);
      setChats((prev) => prev.filter((c) => c.id !== chatId));

      if (!target?.persisted) return;
      try {
        await db.deleteChat(chatId);
      } catch (error) {
        handleFailure(error, 'Could not delete that chat.');
      }
    },
    [activeId, chats, db, handleFailure],
  );

  const handleRenameChat = useCallback(
    async (chatId, title) => {
      patchChat(chatId, { title, titleLocked: true });
      const target = chats.find((c) => c.id === chatId);
      if (!target?.persisted) return;
      try {
        await db.updateChat(chatId, { title, titleLocked: true });
      } catch (error) {
        handleFailure(error, 'Could not rename that chat.');
      }
    },
    [chats, db, handleFailure, patchChat],
  );

  const handleModelChange = useCallback(
    async (modelId) => {
      if (!activeChat) return;
      patchChat(activeChat.id, { model: modelId });
      if (!activeChat.persisted) return;
      try {
        await db.updateChat(activeChat.id, { model: modelId });
      } catch {
        /* the in-memory choice still applies to the next message */
      }
    },
    [activeChat, db, patchChat],
  );

  const messages = activeChat?.messages ?? [];
  const isEmpty = messages.length === 0;
  const loadingMessages = Boolean(activeChat && !activeChat.loaded);

  if (booting) {
    return (
      <div className="boot">
        <span className="boot-mark">
          <Icon.Sparkle width={30} height={30} />
        </span>
        <p>Loading your chats…</p>
      </div>
    );
  }

  return (
    <div className={`app${sidebarOpen ? ' sidebar-open' : ''}`}>
      <Sidebar
        open={sidebarOpen}
        chats={chats.filter((c) => c.persisted)}
        activeId={activeId}
        theme={theme}
        onClose={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelect={handleSelectChat}
        onRename={handleRenameChat}
        onDelete={handleDeleteChat}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />

      <main className="main">
        <header className="topbar">
          {!sidebarOpen && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Icon.Menu />
            </button>
          )}
          <div className="brand">
            <span className="brand-name">Gemini</span>
            <ModelPicker
              models={models}
              value={activeChat?.model}
              onChange={handleModelChange}
              disabled={Boolean(streamingId)}
            />
          </div>
          <button
            type="button"
            className={`icon-btn${activeChat?.temporary ? ' active' : ''}`}
            onClick={handleToggleTemporary}
            aria-pressed={Boolean(activeChat?.temporary)}
            aria-label={activeChat?.temporary ? 'Leave temporary chat' : 'Start a temporary chat'}
            title={activeChat?.temporary ? 'Leave temporary chat' : 'Temporary chat'}
          >
            <Icon.Temporary />
          </button>
          <UserMenu user={user} onSignOut={onSignOut} />
        </header>

        <div className="scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="thread">
            {activeChat?.temporary && (
              <div className="temp-banner">
                <Icon.Temporary width={18} height={18} />
                <span>
                  <strong>Temporary chat.</strong> Nothing here is saved to your history — it
                  disappears when you reload or open another chat.
                </span>
              </div>
            )}
            {loadingMessages ? (
              <div className="thread-loading">
                <div className="typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : isEmpty ? (
              <Welcome
                greeting={greeting}
                onPick={(text) => setSeed((prev) => ({ text, nonce: prev.nonce + 1 }))}
              />
            ) : (
              messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  streaming={message.id === streamingId}
                  onRegenerate={handleRegenerate}
                  onEdit={handleEdit}
                />
              ))
            )}
          </div>
        </div>

        <Composer
          key={activeId}
          seed={seed}
          onSend={handleSend}
          onStop={() => abortRef.current?.abort()}
          busy={Boolean(streamingId)}
          searchGrounding={searchGrounding}
          onToggleSearch={() => setSearchGrounding((v) => !v)}
          supportsSearch={!activeModel?.image}
          supportsAttachments
          placeholder={
            activeModel?.image ? 'Describe an image to create…' : 'Ask Gemini anything…'
          }
          onNotify={setToast}
        />
      </main>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            type="button"
            className="icon-btn tiny"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
          >
            <Icon.Close width={14} height={14} />
          </button>
        </div>
      )}
    </div>
  );
}
