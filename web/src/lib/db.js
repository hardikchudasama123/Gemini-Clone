const BUCKET = 'chat-media';
const SIGNED_URL_TTL = 60 * 60 * 8;

function extensionFor(mimeType = '') {
  const subtype = mimeType.split('/')[1] || 'bin';
  return subtype.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

function rowToMessage(row) {
  return {
    id: row.id,
    seq: row.seq,
    role: row.role,
    text: row.text || '',
    thought: row.thought || '',
    parts: row.parts || [],
    attachments: row.attachments || [],
    images: row.images || [],
    sources: row.sources || [],
    usage: row.usage || null,
    error: row.error || null,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}

function rowToChat(row) {
  return {
    id: row.id,
    title: row.title,
    titleLocked: row.title_locked,
    model: row.model,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    messages: [],
    loaded: false,
    persisted: true,
  };
}

/**
 * All persistence for one signed-in user. Every query relies on RLS for
 * isolation; `userId` is only used to build storage paths and satisfy the
 * not-null owner columns.
 */
export function createDb(supabase, userId) {
  const fail = (error, action) => {
    if (error) throw new Error(`${action}: ${error.message}`);
  };

  /** Replace base64 payloads with storage paths, uploading as we go. */
  async function uploadMedia(chatId, message) {
    const attachments = [];
    const images = [];

    for (const [index, item] of (message.attachments || []).entries()) {
      if (!item.data) {
        attachments.push(item);
        continue;
      }
      const path = `${userId}/${chatId}/${message.id}-a${index}.${extensionFor(item.mimeType)}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, base64ToBlob(item.data, item.mimeType), {
          contentType: item.mimeType,
          upsert: true,
        });
      fail(error, 'Uploading attachment');
      attachments.push({ name: item.name, mimeType: item.mimeType, size: item.size, path });
    }

    for (const [index, image] of (message.images || []).entries()) {
      if (!image.data) {
        images.push(image);
        continue;
      }
      const path = `${userId}/${chatId}/${message.id}-i${index}.${extensionFor(image.mimeType)}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, base64ToBlob(image.data, image.mimeType), {
          contentType: image.mimeType,
          upsert: true,
        });
      fail(error, 'Uploading image');
      images.push({ mimeType: image.mimeType, path });
    }

    return { attachments, images };
  }

  /** Turn stored paths into signed URLs the browser can render. */
  async function signMedia(messages) {
    const paths = [];
    for (const message of messages) {
      for (const item of message.attachments || []) if (item.path) paths.push(item.path);
      for (const image of message.images || []) if (image.path) paths.push(image.path);
    }
    if (!paths.length) return messages;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL);

    // Missing media should not blank the conversation — fall through to the
    // "not available" placeholder instead.
    if (error) return messages;

    const urls = new Map();
    for (const entry of data || []) {
      if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
    }

    return messages.map((message) => ({
      ...message,
      attachments: (message.attachments || []).map((item) =>
        item.path ? { ...item, url: urls.get(item.path) || null } : item,
      ),
      images: (message.images || []).map((image) =>
        image.path ? { ...image, url: urls.get(image.path) || null } : image,
      ),
    }));
  }

  return {
    async listChats() {
      const { data, error } = await supabase
        .from('chats')
        .select('id,title,title_locked,model,created_at,updated_at')
        .order('updated_at', { ascending: false })
        .limit(300);
      fail(error, 'Loading chats');
      return (data || []).map(rowToChat);
    },

    async loadMessages(chatId) {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('seq', { ascending: true });
      fail(error, 'Loading messages');
      return signMedia((data || []).map(rowToMessage));
    },

    async createChat({ id, model, title = 'New chat' }) {
      const { error } = await supabase
        .from('chats')
        .insert({ id, user_id: userId, model, title });
      fail(error, 'Creating chat');
    },

    async updateChat(id, patch) {
      const row = {};
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.titleLocked !== undefined) row.title_locked = patch.titleLocked;
      if (patch.model !== undefined) row.model = patch.model;
      if (!Object.keys(row).length) return;

      const { error } = await supabase.from('chats').update(row).eq('id', id);
      fail(error, 'Updating chat');
    },

    async deleteChat(id) {
      // Messages cascade in Postgres; storage objects must go explicitly.
      const { data: files } = await supabase.storage.from(BUCKET).list(`${userId}/${id}`);
      if (files?.length) {
        await supabase.storage
          .from(BUCKET)
          .remove(files.map((file) => `${userId}/${id}/${file.name}`));
      }
      const { error } = await supabase.from('chats').delete().eq('id', id);
      fail(error, 'Deleting chat');
    },

    /** Insert or replace one message, uploading any binary payloads first. */
    async saveMessage(chatId, message) {
      const { attachments, images } = await uploadMedia(chatId, message);

      const { error } = await supabase.from('messages').upsert(
        {
          id: message.id,
          chat_id: chatId,
          user_id: userId,
          seq: message.seq,
          role: message.role,
          text: message.text || '',
          thought: message.thought || '',
          parts: message.parts || [],
          attachments,
          images,
          sources: message.sources || [],
          usage: message.usage || null,
          error: message.error || null,
        },
        { onConflict: 'id' },
      );
      fail(error, 'Saving message');
      return { attachments, images };
    },

    /** Drop this message and everything after it (regenerate / edit). */
    async deleteMessagesFrom(chatId, seq) {
      const { data: doomed } = await supabase
        .from('messages')
        .select('attachments,images')
        .eq('chat_id', chatId)
        .gte('seq', seq);

      const paths = [];
      for (const row of doomed || []) {
        for (const item of row.attachments || []) if (item.path) paths.push(item.path);
        for (const image of row.images || []) if (image.path) paths.push(image.path);
      }
      if (paths.length) await supabase.storage.from(BUCKET).remove(paths);

      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('chat_id', chatId)
        .gte('seq', seq);
      fail(error, 'Removing messages');
    },
  };
}
