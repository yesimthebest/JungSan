import {
  createClient,
  type RealtimeChannel,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

export type Participant = { id: string; name: string };
export type Expense = {
  id: string;
  title: string;
  payerId: string;
  amount: number;
  participantIds: string[];
};
export type Transfer = {
  id: string;
  date: string;
  senderId: string;
  receiverId: string;
  amount: number;
};
export type SettlementData = {
  title: string;
  participants: Participant[];
  expenses: Expense[];
  transfers: Transfer[];
};
export type SettlementRecord = {
  id: string;
  title: string;
  data: SettlementData;
  owner_id: string;
  share_token: string;
  created_at: string;
  updated_at: string;
};

const LOCAL_KEY = "zizon-settlements-v1";
const LOCAL_USER_ID = "local-user";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isCloudEnabled = Boolean(supabaseUrl && supabaseAnonKey);
const supabase: SupabaseClient | null = isCloudEnabled
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

function loadLocal(): SettlementRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]") as SettlementRecord[];
  } catch {
    return [];
  }
}

function saveLocal(records: SettlementRecord[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(records));
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(callback: (session: Session | null) => void) {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function sendMagicLink(email: string) {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.search },
  });
  if (error) throw error;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function joinSettlement(token: string): Promise<string> {
  if (!supabase) return "";
  const { data, error } = await supabase.rpc("join_settlement", { invitation_token: token });
  if (error) throw error;
  return data as string;
}

export async function listSettlements(): Promise<SettlementRecord[]> {
  if (!supabase) {
    return loadLocal().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data as SettlementRecord[];
}

export async function getSettlement(id: string): Promise<SettlementRecord | null> {
  if (!supabase) return loadLocal().find((record) => record.id === id) || null;
  const { data, error } = await supabase
    .from("settlements")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as SettlementRecord | null;
}

export async function createSettlement(data: SettlementData): Promise<SettlementRecord> {
  const now = new Date().toISOString();
  if (!supabase) {
    const record: SettlementRecord = {
      id: crypto.randomUUID(),
      title: data.title,
      data,
      owner_id: LOCAL_USER_ID,
      share_token: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
    };
    saveLocal([record, ...loadLocal()]);
    return record;
  }
  const { data: record, error } = await supabase
    .from("settlements")
    .insert({ title: data.title, data })
    .select()
    .single();
  if (error) throw error;
  return record as SettlementRecord;
}

export async function updateSettlement(id: string, data: SettlementData): Promise<void> {
  if (!supabase) {
    saveLocal(
      loadLocal().map((record) =>
        record.id === id
          ? { ...record, title: data.title, data, updated_at: new Date().toISOString() }
          : record,
      ),
    );
    return;
  }
  const { error } = await supabase
    .from("settlements")
    .update({ title: data.title, data })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteSettlement(id: string): Promise<void> {
  if (!supabase) {
    saveLocal(loadLocal().filter((record) => record.id !== id));
    return;
  }
  const { error } = await supabase.from("settlements").delete().eq("id", id);
  if (error) throw error;
}

export function subscribeToSettlements(onChange: () => void): () => void {
  if (!supabase) return () => undefined;
  const channel: RealtimeChannel = supabase
    .channel("settlements-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "settlements" }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
