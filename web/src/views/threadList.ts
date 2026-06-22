import { repo } from "../repo/index.ts";
import type { Session } from "../auth.ts";
import { escapeHtml, formatDate } from "../ui.ts";
import { appShell, setMain } from "./shell.ts";

export async function renderThreadList(
  root: HTMLElement,
  session: Session,
): Promise<void> {
  root.innerHTML = appShell(session, `<p class="muted">Loading threads…</p>`);

  let threads;
  try {
    threads = await repo.listThreads();
  } catch (err) {
    setMain(root, `<p class="err">Failed to load threads: ${escapeHtml(String(err))}</p>`);
    return;
  }

  if (threads.length === 0) {
    setMain(root, `<p class="muted">No threads yet.</p>`);
    return;
  }

  const rows = threads
    .map(
      (t) => `
      <li class="thread-row">
        <a href="#/thread/${encodeURIComponent(t.id)}">
          <span class="thread-subject">${escapeHtml(t.subject)}</span>
          <span class="thread-meta">
            ${t.messageCount} message${t.messageCount === 1 ? "" : "s"}
            ${t.participantCount ? `· ${t.participantCount} participant${t.participantCount === 1 ? "" : "s"}` : ""}
            · ${escapeHtml(formatDate(t.lastMessageAt))}
          </span>
        </a>
      </li>`,
    )
    .join("");

  setMain(root, `<ul class="thread-list">${rows}</ul>`);
}
