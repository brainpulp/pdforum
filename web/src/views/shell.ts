import type { Session } from "../auth.ts";
import { escapeHtml } from "../ui.ts";

/** The signed-in chrome: top bar, read-only banner, and a #main container. */
export function appShell(session: Session, mainHtml: string): string {
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <a href="#/" class="brand">pdforum</a>
        <div class="topbar-right">
          <span class="muted small">${escapeHtml(session.email)}</span>
          <button id="signout" class="link-btn">Sign out</button>
        </div>
      </div>
    </header>
    <div class="mirror-banner">
      Read-only mirror of a private mailing list. You can read, but not post.
    </div>
    <main class="content" id="main">${mainHtml}</main>
  `;
}

export function setMain(root: HTMLElement, html: string): void {
  const main = root.querySelector("#main");
  if (main) main.innerHTML = html;
}
