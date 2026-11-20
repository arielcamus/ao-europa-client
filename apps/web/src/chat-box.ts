/*
 * The chat input box (frmMain SendTxt / SendTxtCmsg), 2026-11-20. Enter opens it,
 * Enter sends, Delete opens the guild box, a click on "[Name]" in the console starts a whisper.
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 */
import { CHAT_MAX_LENGTH, ChatInput, filterChatText } from './chat-input.js';
import type { Session } from './session.js';

export class ChatBox {
  private input = new ChatInput();
  private session: Session | undefined;
  private guild = false;

  constructor(
    private readonly form: HTMLFormElement,
    private readonly field: HTMLInputElement,
    private readonly messages: HTMLElement,
    private readonly onClose: () => void,
    private readonly onFailure: (error: unknown) => void,
  ) {
    field.maxLength = CHAT_MAX_LENGTH;
    field.addEventListener('input', () => {
      const clean = filterChatText(field.value);
      if (clean !== field.value) field.value = clean;
    });
    form.addEventListener('submit', event => { event.preventDefault(); this.submit(); });
    // RecTxt_MouseUp: the first "[Name]" on the clicked line is the whisper target ("A" is the announcer).
    messages.addEventListener('click', event => {
      const row = (event.target as HTMLElement).closest('#messages > div');
      const name = /\[([^\]]*)\]/.exec(row?.textContent ?? '')?.[1];
      if (name && name !== 'A' && this.session?.ready && !this.guild) { this.input.whisperTo(name); this.open(); }
    });
  }
  /** A new connection starts with a fresh SendingType; packet counters live in the Session (PacketCounters). */
  attach(session: Session | undefined) { if (session !== this.session) { this.session = session; this.input = new ChatInput(); this.close(); } }
  get visible() { return !this.form.hidden; }

  /** OpenChatInput (Enter) or OpenAndFocusClanChat (Delete). */
  open(guild = false) {
    if (!this.session?.ready || (this.visible && this.guild !== guild)) return;
    this.guild = guild;
    this.form.classList.toggle('guild', guild);
    this.field.value = guild ? '' : this.input.prefill();
    this.form.hidden = false; this.field.focus();
    this.field.setSelectionRange(this.field.value.length, this.field.value.length);
  }
  close() {
    const wasOpen = this.visible;
    this.form.hidden = true; this.field.value = ''; this.guild = false;
    if (wasOpen) this.onClose();
  }

  /** SendTxt_KeyUp / SendTxtCmsg_KeyUp. */
  private submit() {
    const session = this.session;
    if (!session) return;
    const text = this.field.value;
    try {
      const outcome = this.guild ? this.input.guildMessage(text) : this.input.submit(text, { level: session.ui.stats.level });
      let ok = true;
      if (outcome.talk !== undefined) ok = outcome.talk.trim() === '' || session.talk(outcome.talk);
      else if (outcome.packet) ok = session.sendChat(outcome.packet);
      for (const note of outcome.notes) session.ui.message(note.text, note.font);
      if (!ok) { session.ui.message('Espera un momento o acorta el mensaje (máximo 255 bytes).'); return; }
      this.close();
    } catch (error) { this.onFailure(error); }
  }
}
