import { repo } from "../repo/index.ts";
import type { Session } from "../auth.ts";
import { buildMessageTree } from "../tree.ts";
import { escapeHtml, formatDate, messageText, senderLabel } from "../ui.ts";
import { appShell, setMain } from "./shell.ts";

export async function renderThreadView(
  root: HTMLElement,
  session: Session,
  threadId: string,
): Promise<void> {
  root.innerHTML = appShell(session, `<p class="muted">Loading thread…</p>`);

  let detail;
  try {
    detail = await repo.getThread(threadId);
  } catch (err) {
    setMain(root, `<p class="err">Failed to load thread: ${escapeHtml(String(err))}</p>`);
    return;
  }

  if (!detail) {
    setMain(root, `<p class="err">Thread not found.</p><p><a href="#/">← Back</a></p>`);
    return;
  }

  const tree = buildMessageTree(detail.messages);
  const messagesHtml = tree
    .map((node) => {
      const m = node.message;
      const depth = Math.min(node.depth, 6); // cap indentation
      const text = messageText(m.bodyText, m.bodyHtml);
      return `
        <article class="message" style="margin-left:${depth * 1.5}rem">
          <div class="message-head">
            <span class="sender">${escapeHtml(senderLabel(m.fromName, m.fromEmail))}</span>
            <span class="muted small">${escapeHtml(formatDate(m.sentAt))}</span>
          </div>
          <pre class="message-body">${escapeHtml(text)}</pre>
        </article>`;
    })
    .join("");

  setMain(
    root,
    `
      <p class="back"><a href="#/">← All threads</a></p>
      <h1 class="thread-title">${escapeHtml(detail.thread.subject)}</h1>
      <div class="thread-messages">${messagesHtml}</div>
    `,
  );
}
