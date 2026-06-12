import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
  shareKey: string;
  ownerKey?: string;
  created_at: string;
  updated_at: string;
};

type StoredCredential = {
  id: string;
  shareKey: string;
  ownerKey?: string;
};

type RpcRecord = {
  id: string;
  title: string;
  data: SettlementData;
  share_key: string;
  owner_key?: string;
  created_at: string;
  updated_at: string;
};

const CREDENTIALS_KEY = "zizon-settlement-keys-v2";
const LOCAL_RECORDS_KEY = "zizon-settlements-local-v2";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isCloudEnabled = Boolean(supabaseUrl && supabaseAnonKey);
const supabase: SupabaseClient | null = isCloudEnabled
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

function normalizeKey(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function formatShareKey(value: string) {
  return normalizeKey(value).slice(0, 4);
}

function getCredentials(): StoredCredential[] {
  try {
    const saved = JSON.parse(
      localStorage.getItem(CREDENTIALS_KEY) || "[]",
    ) as StoredCredential[];
    const migrated = saved.map((item) => ({
      ...item,
      shareKey: normalizeKey(item.shareKey).slice(0, 4),
    }));
    if (JSON.stringify(saved) !== JSON.stringify(migrated)) {
      localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return [];
  }
}

function saveCredential(credential: StoredCredential) {
  const rest = getCredentials().filter((item) => item.id !== credential.id);
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify([credential, ...rest]));
}

function removeCredential(id: string) {
  localStorage.setItem(
    CREDENTIALS_KEY,
    JSON.stringify(getCredentials().filter((item) => item.id !== id)),
  );
}

function getLocalRecords(): SettlementRecord[] {
  try {
    const saved = JSON.parse(
      localStorage.getItem(LOCAL_RECORDS_KEY) || "[]",
    ) as SettlementRecord[];
    const used = new Set<string>();
    let changed = false;
    const migrated = saved.map((record) => {
      let key = normalizeKey(record.shareKey).slice(0, 4);
      if (key.length !== 4 || used.has(key)) {
        key = makeLocalShareKey(used);
      }
      used.add(key);
      if (record.shareKey !== key) changed = true;
      return { ...record, shareKey: key };
    });
    if (changed) saveLocalRecords(migrated);
    return migrated;
  } catch {
    return [];
  }
}

function saveLocalRecords(records: SettlementRecord[]) {
  localStorage.setItem(LOCAL_RECORDS_KEY, JSON.stringify(records));
}

function makeLocalShareKey(used = new Set<string>()) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let key = "";
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    key = Array.from(bytes, (byte) => characters[byte % characters.length]).join("");
  } while (used.has(key));
  return key;
}

function fromRpc(record: RpcRecord, ownerKey?: string): SettlementRecord {
  return {
    id: record.id,
    title: record.title,
    data: record.data,
    shareKey: record.share_key,
    ownerKey,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export async function listSettlements(): Promise<SettlementRecord[]> {
  if (!supabase) {
    return getLocalRecords().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  const results = await Promise.all(
    getCredentials().map(async (credential) => {
      const { data, error } = await supabase.rpc("get_settlement", {
        target_id: credential.id,
        access_key: credential.ownerKey || credential.shareKey,
      });
      if (error || !data) return null;
      const record = fromRpc(data as RpcRecord, credential.ownerKey);
      saveCredential({ id: record.id, shareKey: record.shareKey, ownerKey: credential.ownerKey });
      return record;
    }),
  );
  return results
    .filter((record): record is SettlementRecord => Boolean(record))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getSettlement(id: string): Promise<SettlementRecord | null> {
  if (!supabase) return getLocalRecords().find((record) => record.id === id) || null;
  const credential = getCredentials().find((item) => item.id === id);
  if (!credential) return null;
  const { data, error } = await supabase.rpc("get_settlement", {
    target_id: id,
    access_key: credential.ownerKey || credential.shareKey,
  });
  if (error) throw error;
  return data ? fromRpc(data as RpcRecord, credential.ownerKey) : null;
}

export async function createSettlement(data: SettlementData): Promise<SettlementRecord> {
  const now = new Date().toISOString();
  if (!supabase) {
    const existingRecords = getLocalRecords();
    const record: SettlementRecord = {
      id: crypto.randomUUID(),
      title: data.title,
      data,
      shareKey: makeLocalShareKey(new Set(existingRecords.map((item) => item.shareKey))),
      ownerKey: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
    };
    saveLocalRecords([record, ...existingRecords]);
    return record;
  }

  const { data: result, error } = await supabase.rpc("create_settlement", {
    settlement_title: data.title,
    settlement_data: data,
  });
  if (error) throw error;
  const rpcRecord = result as RpcRecord;
  const record = fromRpc(rpcRecord, rpcRecord.owner_key);
  saveCredential({ id: record.id, shareKey: record.shareKey, ownerKey: record.ownerKey });
  return record;
}

export async function joinSettlement(shareKey: string): Promise<SettlementRecord> {
  const normalized = normalizeKey(shareKey);
  if (!normalized) throw new Error("참여 키를 입력해 주세요.");

  if (!supabase) {
    const record = getLocalRecords().find((item) => normalizeKey(item.shareKey) === normalized);
    if (!record) throw new Error("일치하는 정산을 찾을 수 없습니다.");
    return { ...record, ownerKey: undefined };
  }

  const { data, error } = await supabase.rpc("join_settlement", {
    participation_key: normalized,
  });
  if (error) throw error;
  if (!data) throw new Error("일치하는 정산을 찾을 수 없습니다.");
  const record = fromRpc(data as RpcRecord);
  saveCredential({ id: record.id, shareKey: record.shareKey });
  return record;
}

export async function updateSettlement(
  record: SettlementRecord,
  data: SettlementData,
): Promise<void> {
  if (!supabase) {
    saveLocalRecords(
      getLocalRecords().map((item) =>
        item.id === record.id
          ? { ...item, title: data.title, data, updated_at: new Date().toISOString() }
          : item,
      ),
    );
    return;
  }
  const { error } = await supabase.rpc("update_settlement", {
    target_id: record.id,
    access_key: record.ownerKey || record.shareKey,
    settlement_title: data.title,
    settlement_data: data,
  });
  if (error) throw error;
}

export async function deleteSettlement(record: SettlementRecord): Promise<void> {
  if (!record.ownerKey) throw new Error("정산을 만든 기기에서만 삭제할 수 있습니다.");
  if (!supabase) {
    saveLocalRecords(getLocalRecords().filter((item) => item.id !== record.id));
    return;
  }
  const { error } = await supabase.rpc("delete_settlement", {
    target_id: record.id,
    deletion_key: record.ownerKey,
  });
  if (error) throw error;
  removeCredential(record.id);
}

export function subscribeToSettlements(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, 5000);
  return () => window.clearInterval(timer);
}
