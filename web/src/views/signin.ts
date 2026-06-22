import { auth } from "../auth.ts";
import { config } from "../config.ts";

export function renderSignIn(root: HTMLElement): void {
  root.innerHTML = `
    <main class="centered">
      <section class="card signin">
        <h1>pdforum</h1>
        <p class="muted">A read-only mirror of a private mailing list.</p>
        ${config.useMock ? '<p class="badge">mock data mode</p>' : ""}
        <form id="signin-form">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required
                 placeholder="you@example.org" autocomplete="email" />
          <button type="submit">Send sign-in link</button>
        </form>
        <p id="signin-msg" class="msg" role="status"></p>
        <p class="muted small">Invite-only. Only known members can sign in.</p>
      </section>
    </main>
  `;

  const form = root.querySelector<HTMLFormElement>("#signin-form")!;
  const msg = root.querySelector<HTMLParagraphElement>("#signin-msg")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = new FormData(form).get("email") as string;
    msg.textContent = "Sending…";
    const result = await auth.signIn(email.trim());
    msg.textContent = result.message;
    msg.className = `msg ${result.ok ? "ok" : "err"}`;
    if (result.ok) form.reset();
  });
}
