import "./styles.css";
import { auth } from "./auth.ts";
import { renderSignIn } from "./views/signin.ts";
import { renderThreadList } from "./views/threadList.ts";
import { renderThreadView } from "./views/threadView.ts";

const root = document.getElementById("app")!;

async function route(): Promise<void> {
  const session = await auth.getSession();
  if (!session) {
    renderSignIn(root);
    return;
  }

  const hash = location.hash || "#/";
  const threadMatch = hash.match(/^#\/thread\/(.+)$/);
  if (threadMatch) {
    await renderThreadView(root, session, decodeURIComponent(threadMatch[1]));
  } else {
    await renderThreadList(root, session);
  }

  // Wire the sign-out button if present.
  const signout = document.getElementById("signout");
  signout?.addEventListener("click", async () => {
    await auth.signOut();
    location.hash = "#/";
  });
}

window.addEventListener("hashchange", route);
auth.onChange(route);
void route();
