// Data shapes and the repository interface the UI depends on. Both the mock
// and Supabase implementations satisfy `Repo`, so views never know which is in
// use.

export interface ThreadSummary {
  id: string;
  subject: string;
  lastMessageAt: string | null;
  messageCount: number;
  participantCount: number;
}

export interface MessageRecord {
  id: string;
  rfcMessageId: string;
  inReplyTo: string | null;
  references: string[];
  fromName: string | null;
  fromEmail: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: string | null;
}

export interface ThreadDetail {
  thread: ThreadSummary;
  messages: MessageRecord[];
}

export interface Repo {
  listThreads(): Promise<ThreadSummary[]>;
  getThread(threadId: string): Promise<ThreadDetail | null>;
}
