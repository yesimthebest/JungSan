import {
  ArrowDownLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDollarSign,
  Cloud,
  Download,
  FolderOpen,
  Home,
  KeyRound,
  Plus,
  ReceiptText,
  RotateCcw,
  Settings2,
  Trash2,
  Upload,
  WalletCards,
  X,
  createIcons,
} from "lucide";
import "./style.css";
import {
  createSettlement,
  deleteSettlement,
  getSettlement,
  formatShareKey,
  isCloudEnabled,
  joinSettlement,
  listSettlements,
  subscribeToSettlements,
  updateSettlement,
  type Expense,
  type Participant,
  type SettlementData,
  type SettlementRecord,
  type Transfer,
} from "./database";

type AppState = SettlementData;

type PersonSummary = Participant & {
  paid: number;
  owed: number;
  sent: number;
  received: number;
  balance: number;
};

type Settlement = {
  senderId: string;
  receiverId: string;
  amount: number;
};

const icons = {
  ArrowDownLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDollarSign,
  Cloud,
  Download,
  FolderOpen,
  Home,
  KeyRound,
  Plus,
  ReceiptText,
  RotateCcw,
  Settings2,
  Trash2,
  Upload,
  WalletCards,
  X,
};

const initialState: AppState = {
  title: "새 정산",
  participants: [
    { id: "p1", name: "참여자 1" },
    { id: "p2", name: "참여자 2" },
  ],
  expenses: [
    {
      id: "e1",
      title: "비용 1",
      payerId: "",
      amount: 0,
      participantIds: ["p1", "p2"],
    },
  ],
  transfers: [],
};

const cloneInitialState = (): AppState => structuredClone(initialState);

let state = cloneInitialState();
let settingsOpen = false;
let currentRecord: SettlementRecord | null = null;
let records: SettlementRecord[] = [];
let saveTimer = 0;
let saveStatus: "saved" | "saving" | "error" = "saved";
let unsubscribeRealtime: () => void = () => undefined;

function saveState() {
  if (!currentRecord) return;
  currentRecord.title = state.title;
  currentRecord.data = structuredClone(state);
  const recordId = currentRecord.id;
  const snapshot = structuredClone(state);
  saveStatus = "saving";
  updateSaveIndicator();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      const record = currentRecord?.id === recordId ? currentRecord : records.find((item) => item.id === recordId);
      if (!record) throw new Error("정산 접근 키를 찾을 수 없습니다.");
      await updateSettlement(record, snapshot);
      saveStatus = "saved";
    } catch (error) {
      console.error(error);
      saveStatus = "error";
    }
    updateSaveIndicator();
  }, 550);
}

function updateSaveIndicator() {
  const indicator = document.querySelector<HTMLElement>("#save-indicator");
  if (!indicator) return;
  indicator.className = `autosave-note ${saveStatus}`;
  indicator.innerHTML =
    saveStatus === "saving"
      ? "<span></span> 저장 중..."
      : saveStatus === "error"
        ? "<span></span> 저장에 실패했습니다."
        : `<span></span> ${isCloudEnabled ? "공용 데이터베이스에 저장됨" : "이 기기에 저장됨"}`;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatWon(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function participantName(id: string) {
  return state.participants.find((person) => person.id === id)?.name || "선택 안 함";
}

function getSummary(): PersonSummary[] {
  return state.participants.map((person) => {
    const paid = state.expenses
      .filter((expense) => expense.payerId === person.id)
      .reduce((sum, expense) => sum + expense.amount, 0);

    const owed = state.expenses.reduce((sum, expense) => {
      if (!expense.participantIds.includes(person.id) || expense.participantIds.length === 0) {
        return sum;
      }
      return sum + expense.amount / expense.participantIds.length;
    }, 0);

    const sent = state.transfers
      .filter((transfer) => transfer.senderId === person.id)
      .reduce((sum, transfer) => sum + transfer.amount, 0);

    const received = state.transfers
      .filter((transfer) => transfer.receiverId === person.id)
      .reduce((sum, transfer) => sum + transfer.amount, 0);

    return { ...person, paid, owed, sent, received, balance: paid - owed + sent - received };
  });
}

function getSettlements(summary: PersonSummary[]): Settlement[] {
  const creditors = summary
    .filter((person) => person.balance > 0.5)
    .map((person) => ({ id: person.id, amount: person.balance }));
  const debtors = summary
    .filter((person) => person.balance < -0.5)
    .map((person) => ({ id: person.id, amount: -person.balance }));
  const results: Settlement[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = Math.min(creditor.amount, debtor.amount);

    if (amount > 0.5) {
      results.push({
        senderId: debtor.id,
        receiverId: creditor.id,
        amount: Math.round(amount),
      });
    }

    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount < 0.5) creditorIndex += 1;
    if (debtor.amount < 0.5) debtorIndex += 1;
  }

  return results;
}

function selectOptions(selectedId: string, excludedId = "") {
  return [
    `<option value="">선택</option>`,
    ...state.participants
      .filter((person) => person.id !== excludedId)
      .map(
        (person) =>
          `<option value="${person.id}" ${person.id === selectedId ? "selected" : ""}>${escapeHtml(person.name)}</option>`,
      ),
  ].join("");
}

function renderExpense(expense: Expense, index: number) {
  const share =
    expense.participantIds.length > 0 ? expense.amount / expense.participantIds.length : 0;

  return `
    <article class="entry-card expense-card" data-id="${expense.id}">
      <div class="entry-heading">
        <span class="entry-number">${String(index + 1).padStart(2, "0")}</span>
        <button class="icon-button subtle delete-expense" aria-label="비용 삭제">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
      <label class="field">
        <span>항목</span>
        <input class="expense-title" type="text" value="${escapeHtml(expense.title)}" placeholder="예: 숙박비" />
      </label>
      <div class="two-columns">
        <label class="field">
          <span>결제자</span>
          <span class="select-wrap">
            <select class="expense-payer">${selectOptions(expense.payerId)}</select>
            <i data-lucide="chevron-down"></i>
          </span>
        </label>
        <label class="field">
          <span>결제금액</span>
          <span class="money-input">
            <input class="expense-amount" type="text" inputmode="numeric" value="${expense.amount ? expense.amount.toLocaleString("ko-KR") : ""}" placeholder="0" />
            <b>원</b>
          </span>
        </label>
      </div>
      <div class="participants-field">
        <div class="field-label">
          <span>함께 나눈 사람</span>
          <span>${expense.participantIds.length}명 · 1인 ${formatWon(share)}</span>
        </div>
        <div class="participant-chips">
          ${state.participants
            .map(
              (person) => `
                <button class="participant-chip ${expense.participantIds.includes(person.id) ? "active" : ""}" data-person-id="${person.id}">
                  <span class="check-circle"><i data-lucide="check"></i></span>
                  ${escapeHtml(person.name)}
                </button>
              `,
            )
            .join("")}
        </div>
      </div>
    </article>
  `;
}

function renderTransfer(transfer: Transfer) {
  return `
    <article class="entry-card transfer-card" data-id="${transfer.id}">
      <div class="transfer-route">
        <label class="compact-field">
          <span>보낸 사람</span>
          <span class="select-wrap">
            <select class="transfer-sender">${selectOptions(transfer.senderId, transfer.receiverId)}</select>
            <i data-lucide="chevron-down"></i>
          </span>
        </label>
        <span class="route-arrow"><i data-lucide="arrow-right"></i></span>
        <label class="compact-field">
          <span>받은 사람</span>
          <span class="select-wrap">
            <select class="transfer-receiver">${selectOptions(transfer.receiverId, transfer.senderId)}</select>
            <i data-lucide="chevron-down"></i>
          </span>
        </label>
      </div>
      <div class="transfer-bottom">
        <label class="field">
          <span>날짜</span>
          <input class="transfer-date" type="date" value="${transfer.date}" />
        </label>
        <label class="field">
          <span>송금액</span>
          <span class="money-input">
            <input class="transfer-amount" type="text" inputmode="numeric" value="${transfer.amount ? transfer.amount.toLocaleString("ko-KR") : ""}" placeholder="0" />
            <b>원</b>
          </span>
        </label>
        <button class="icon-button delete-transfer" aria-label="송금 내역 삭제">
          <i data-lucide="x"></i>
        </button>
      </div>
    </article>
  `;
}

function renderSettings() {
  return `
    <div class="sheet-backdrop ${settingsOpen ? "open" : ""}" id="settings-backdrop"></div>
    <aside class="settings-sheet ${settingsOpen ? "open" : ""}" aria-hidden="${!settingsOpen}">
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <p class="eyebrow">SETTINGS</p>
          <h2>정산 설정</h2>
        </div>
        <button class="icon-button" id="close-settings" aria-label="설정 닫기"><i data-lucide="x"></i></button>
      </div>
      <label class="field title-field">
        <span>정산 이름</span>
        <input id="settlement-title" type="text" value="${escapeHtml(state.title)}" />
      </label>
      <div class="settings-label">
        <span>참여자</span>
        <span>${state.participants.length}명</span>
      </div>
      <div class="participant-settings">
        ${state.participants
          .map(
            (person, index) => `
              <div class="person-edit" data-id="${person.id}">
                <span class="avatar">${index + 1}</span>
                <input class="person-name" type="text" value="${escapeHtml(person.name)}" aria-label="참여자 이름" />
                <button class="icon-button subtle delete-person" aria-label="참여자 삭제" ${state.participants.length <= 2 ? "disabled" : ""}>
                  <i data-lucide="trash-2"></i>
                </button>
              </div>
            `,
          )
          .join("")}
      </div>
      <button class="outline-button full-width" id="add-person"><i data-lucide="plus"></i> 참여자 추가</button>
      <div class="share-key-box">
        <span>정산 참여 키</span>
        <strong>${currentRecord ? formatShareKey(currentRecord.shareKey) : ""}</strong>
        <button class="primary-button full-width" id="share-settlement"><i data-lucide="key-round"></i> 참여 키 복사</button>
      </div>
      <div class="data-actions">
        <button class="text-action" id="export-data"><i data-lucide="download"></i> 백업</button>
        <label class="text-action file-action"><i data-lucide="upload"></i> 불러오기<input id="import-data" type="file" accept="application/json" /></label>
        <button class="text-action danger" id="reset-data"><i data-lucide="rotate-ccw"></i> 초기화</button>
      </div>
    </aside>
  `;
}

function renderAppHeader(actions = "") {
  return `
    <header class="topbar">
      <button class="brand brand-button" id="brand-home" aria-label="정산 목록으로 이동">
        <span class="brand-mark"><i data-lucide="circle-dollar-sign"></i></span>
        <div>
          <p>SETTLEMENT</p>
          <h1>ZI존정산</h1>
        </div>
      </button>
      <div class="topbar-actions">${actions}</div>
    </header>
  `;
}

function renderLoading(message = "정산을 불러오는 중이에요") {
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    ${renderAppHeader()}
    <main class="center-page">
      <div class="loading-card">
        <span class="loading-icon"><i data-lucide="cloud"></i></span>
        <h2>${escapeHtml(message)}</h2>
        <p>잠시만 기다려 주세요.</p>
      </div>
    </main>
  `;
  createIcons({ icons });
}

function recordTotal(record: SettlementRecord) {
  return record.data.expenses.reduce((sum, expense) => sum + expense.amount, 0);
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function renderRecordCard(record: SettlementRecord) {
  return `
    <article class="settlement-list-card" data-id="${record.id}">
      <button class="settlement-open" aria-label="${escapeHtml(record.title)} 열기">
        <span class="folder-icon"><i data-lucide="folder-open"></i></span>
        <div class="record-main">
          <h3>${escapeHtml(record.title)}</h3>
          <p>${record.data.participants.length}명 · ${record.data.expenses.filter((item) => item.amount > 0).length}개 지출</p>
        </div>
        <strong>${formatWon(recordTotal(record))}</strong>
        <small>${formatUpdatedAt(record.updated_at)} 수정</small>
      </button>
      ${
        record.ownerKey
          ? `<button class="delete-record icon-button" aria-label="${escapeHtml(record.title)} 삭제"><i data-lucide="trash-2"></i></button>`
          : `<span class="shared-badge">참여 중</span>`
      }
    </article>
  `;
}

function renderLanding(mode: "home" | "create" | "join" = "home", errorMessage = "") {
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    ${renderAppHeader()}
    <main class="landing-page">
      <section class="landing-intro">
        <p class="eyebrow">SHARED SETTLEMENT</p>
        <h2>누구나 간편하게<br />함께 정산해요</h2>
        <p>로그인 없이 참여 키 하나로 같은 정산을 공유할 수 있어요.</p>
      </section>
      <section class="start-options">
        <button class="start-option primary-option" id="start-settlement">
          <span class="start-icon"><i data-lucide="plus"></i></span>
          <span><b>정산 시작하기</b><small>새 정산을 만들고 참여 키를 공유해요</small></span>
          <i data-lucide="arrow-right"></i>
        </button>
        <button class="start-option" id="join-settlement">
          <span class="start-icon"><i data-lucide="key-round"></i></span>
          <span><b>정산 참여하기</b><small>공유받은 참여 키로 바로 들어가요</small></span>
          <i data-lucide="arrow-right"></i>
        </button>
      </section>
      ${
        mode === "create"
          ? `<section class="action-panel">
              <div class="action-panel-head">
                <div><p class="eyebrow">NEW SETTLEMENT</p><h3>새 정산 만들기</h3></div>
                <button class="icon-button close-action" aria-label="닫기"><i data-lucide="x"></i></button>
              </div>
              <form id="create-form">
                <label class="field">
                  <span>정산 이름</span>
                  <input id="new-title" type="text" maxlength="40" placeholder="예: 제주 여행 정산" required autofocus />
                </label>
                <button class="primary-button" type="submit">정산 만들기</button>
              </form>
            </section>`
          : ""
      }
      ${
        mode === "join"
          ? `<section class="action-panel">
              <div class="action-panel-head">
                <div><p class="eyebrow">JOIN SETTLEMENT</p><h3>참여 키 입력</h3></div>
                <button class="icon-button close-action" aria-label="닫기"><i data-lucide="x"></i></button>
              </div>
              <form id="join-form">
                <label class="field">
                  <span>참여 키</span>
                  <input id="participation-key" class="key-input" type="text" maxlength="14" autocomplete="off" placeholder="AB12-CD34-EF56" required autofocus />
                </label>
                <button class="primary-button" type="submit">정산 참여하기</button>
              </form>
            </section>`
          : ""
      }
      ${errorMessage ? `<p class="form-error landing-error">${escapeHtml(errorMessage)}</p>` : ""}
      ${
        records.length
          ? `<section class="recent-section">
              <div class="recent-heading"><h3>최근 정산</h3><span>${records.length}개</span></div>
              <div class="settlement-grid">${records.map(renderRecordCard).join("")}</div>
            </section>`
          : ""
      }
      <p class="cloud-note"><i data-lucide="${isCloudEnabled ? "cloud" : "home"}"></i> ${
        isCloudEnabled ? "참여 키로 여러 기기에서 함께 저장됩니다." : "Supabase 연결 전이라 이 기기에만 저장됩니다."
      }</p>
    </main>
  `;
  createIcons({ icons });
  bindLandingEvents();
  bindRecordEvents();
  bindHeaderEvents();
}

function bindLandingEvents() {
  document.querySelector("#start-settlement")?.addEventListener("click", () => renderLanding("create"));
  document.querySelector("#join-settlement")?.addEventListener("click", () => renderLanding("join"));
  document.querySelector(".close-action")?.addEventListener("click", () => renderLanding());

  document.querySelector<HTMLFormElement>("#create-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.querySelector<HTMLInputElement>("#new-title")!.value.trim();
    const button = document.querySelector<HTMLButtonElement>("#create-form button")!;
    button.disabled = true;
    button.textContent = "만드는 중...";
    try {
      const newState = cloneInitialState();
      newState.title = title || "새 정산";
      const record = await createSettlement(newState);
      await openRecord(record.id);
    } catch (error) {
      renderLanding("create", error instanceof Error ? error.message : "정산을 만들지 못했습니다.");
    }
  });

  document.querySelector<HTMLFormElement>("#join-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = document.querySelector<HTMLInputElement>("#participation-key")!.value;
    const button = document.querySelector<HTMLButtonElement>("#join-form button")!;
    button.disabled = true;
    button.textContent = "확인 중...";
    try {
      const record = await joinSettlement(key);
      await openRecord(record.id);
    } catch (error) {
      renderLanding("join", error instanceof Error ? error.message : "참여 키를 확인해 주세요.");
    }
  });

  document.querySelector<HTMLInputElement>("#participation-key")?.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    input.value = formatShareKey(input.value);
  });
}

function render() {
  const summary = getSummary();
  const settlements = getSettlements(summary);
  const totalExpense = state.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const totalTransferred = state.transfers.reduce((sum, transfer) => sum + transfer.amount, 0);
  const populatedExpenseCount = state.expenses.filter((expense) => expense.amount > 0).length;

  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    ${renderAppHeader(`
      <button class="settings-button compact-action" id="go-home"><i data-lucide="home"></i><span>목록</span></button>
      <button class="settings-button compact-action" id="open-settings"><i data-lucide="settings-2"></i><span>설정</span></button>
    `)}
    <main>
      <div class="current-settlement-title">
        <span>현재 정산</span>
        <strong>${escapeHtml(state.title)}</strong>
      </div>
      <section class="hero">
        <div>
          <p class="eyebrow">TOTAL EXPENSE</p>
          <strong>${formatWon(totalExpense)}</strong>
          <span>${state.participants.length}명이 함께한 ${populatedExpenseCount}개의 지출</span>
        </div>
        <div class="hero-icon"><i data-lucide="wallet-cards"></i></div>
      </section>

      <nav class="section-nav" aria-label="페이지 바로가기">
        <a href="#expenses"><span>${String(populatedExpenseCount).padStart(2, "0")}</span> 비용</a>
        <a href="#transfers"><span>${String(state.transfers.length).padStart(2, "0")}</span> 송금</a>
        <a href="#result"><span>${String(settlements.length).padStart(2, "0")}</span> 정산</a>
      </nav>

      <section class="content-section" id="expenses">
        <div class="section-heading">
          <div>
            <p class="eyebrow">01 · EXPENSES</p>
            <h2>비용 입력</h2>
            <p>결제한 사람과 함께 나눌 사람을 선택하세요.</p>
          </div>
          <i data-lucide="receipt-text"></i>
        </div>
        <div class="entries-list">
          ${state.expenses.map(renderExpense).join("")}
        </div>
        <button class="add-button" id="add-expense"><i data-lucide="plus"></i> 비용 추가</button>
      </section>

      <section class="content-section" id="transfers">
        <div class="section-heading">
          <div>
            <p class="eyebrow">02 · TRANSFERS</p>
            <h2>이미 보낸 돈</h2>
            <p>정산 전에 주고받은 금액이 있다면 기록하세요.</p>
          </div>
          <i data-lucide="arrow-down-left"></i>
        </div>
        ${
          state.transfers.length
            ? `<div class="entries-list">${state.transfers.map(renderTransfer).join("")}</div>`
            : `<div class="empty-state"><span><i data-lucide="arrow-down-left"></i></span><b>아직 송금 내역이 없어요</b><p>미리 주고받은 돈이 없다면 비워두세요.</p></div>`
        }
        <button class="add-button" id="add-transfer"><i data-lucide="plus"></i> 송금 내역 추가</button>
        <p class="transfer-total">기록된 송금액 <b>${formatWon(totalTransferred)}</b></p>
      </section>

      <section class="content-section result-section" id="result">
        <div class="section-heading">
          <div>
            <p class="eyebrow">03 · FINAL RESULT</p>
            <h2>최종 정산</h2>
            <p>아래대로 송금하면 모든 정산이 끝납니다.</p>
          </div>
          <i data-lucide="check"></i>
        </div>
        <div class="settlement-result">
          ${
            settlements.length
              ? settlements
                  .map(
                    (item, index) => `
                      <div class="settlement-row">
                        <span class="settlement-index">${index + 1}</span>
                        <div class="settlement-person">
                          <small>보내는 사람</small>
                          <b>${escapeHtml(participantName(item.senderId))}</b>
                        </div>
                        <span class="settlement-arrow"><i data-lucide="arrow-right"></i></span>
                        <div class="settlement-person receiver">
                          <small>받는 사람</small>
                          <b>${escapeHtml(participantName(item.receiverId))}</b>
                        </div>
                        <strong>${formatWon(item.amount)}</strong>
                      </div>
                    `,
                  )
                  .join("")
              : `<div class="all-settled"><span><i data-lucide="check"></i></span><h3>정산이 모두 맞아요</h3><p>추가로 주고받을 금액이 없습니다.</p></div>`
          }
        </div>
        <details class="summary-details">
          <summary>사람별 상세 내역 <i data-lucide="chevron-down"></i></summary>
          <div class="summary-table">
            ${summary
              .map(
                (person) => `
                  <div class="summary-person">
                    <div class="summary-person-head">
                      <b>${escapeHtml(person.name)}</b>
                      <strong class="${person.balance >= 0 ? "positive" : "negative"}">
                        ${person.balance >= 0 ? "받을 돈" : "보낼 돈"} ${formatWon(Math.abs(person.balance))}
                      </strong>
                    </div>
                    <dl>
                      <div><dt>결제</dt><dd>${formatWon(person.paid)}</dd></div>
                      <div><dt>분담</dt><dd>${formatWon(person.owed)}</dd></div>
                      <div><dt>보냄</dt><dd>${formatWon(person.sent)}</dd></div>
                      <div><dt>받음</dt><dd>${formatWon(person.received)}</dd></div>
                    </dl>
                  </div>
                `,
              )
              .join("")}
          </div>
        </details>
      </section>

      <p class="autosave-note ${saveStatus}" id="save-indicator"><span></span> ${
        isCloudEnabled ? "공용 데이터베이스에 저장됨" : "이 기기에 저장됨"
      }</p>
    </main>
    ${renderSettings()}
  `;

  createIcons({ icons });
  bindEvents();
  bindHeaderEvents();
}

function parseMoney(value: string) {
  return Number(value.replace(/[^\d]/g, "")) || 0;
}

function updateAndRender(callback: () => void) {
  callback();
  saveState();
  render();
}

function bindEvents() {
  document.querySelector("#open-settings")?.addEventListener("click", () => {
    settingsOpen = true;
    render();
  });
  document.querySelector("#close-settings")?.addEventListener("click", closeSettings);
  document.querySelector("#settings-backdrop")?.addEventListener("click", closeSettings);

  document.querySelector("#add-expense")?.addEventListener("click", () => {
    updateAndRender(() => {
      state.expenses.push({
        id: uid("e"),
        title: `기타${Math.max(1, state.expenses.length - 1)}`,
        payerId: "",
        amount: 0,
        participantIds: state.participants.map((person) => person.id),
      });
    });
    document.querySelector("#expenses .expense-card:last-of-type")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  document.querySelector("#add-transfer")?.addEventListener("click", () => {
    updateAndRender(() => {
      state.transfers.push({
        id: uid("t"),
        date: new Date().toISOString().slice(0, 10),
        senderId: "",
        receiverId: "",
        amount: 0,
      });
    });
  });

  document.querySelectorAll<HTMLElement>(".expense-card").forEach((card) => {
    const expense = state.expenses.find((item) => item.id === card.dataset.id)!;

    card.querySelector(".delete-expense")?.addEventListener("click", () => {
      updateAndRender(() => {
        state.expenses = state.expenses.filter((item) => item.id !== expense.id);
      });
    });
    card.querySelector<HTMLInputElement>(".expense-title")?.addEventListener("change", (event) => {
      updateAndRender(() => {
        expense.title = (event.target as HTMLInputElement).value.trim() || "이름 없는 비용";
      });
    });
    card.querySelector<HTMLSelectElement>(".expense-payer")?.addEventListener("change", (event) => {
      updateAndRender(() => {
        expense.payerId = (event.target as HTMLSelectElement).value;
      });
    });
    card.querySelector<HTMLInputElement>(".expense-amount")?.addEventListener("change", (event) => {
      updateAndRender(() => {
        expense.amount = parseMoney((event.target as HTMLInputElement).value);
      });
    });
    card.querySelectorAll<HTMLElement>(".participant-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const personId = chip.dataset.personId!;
        updateAndRender(() => {
          expense.participantIds = expense.participantIds.includes(personId)
            ? expense.participantIds.filter((id) => id !== personId)
            : [...expense.participantIds, personId];
        });
      });
    });
  });

  document.querySelectorAll<HTMLElement>(".transfer-card").forEach((card) => {
    const transfer = state.transfers.find((item) => item.id === card.dataset.id)!;

    card.querySelector(".delete-transfer")?.addEventListener("click", () => {
      updateAndRender(() => {
        state.transfers = state.transfers.filter((item) => item.id !== transfer.id);
      });
    });
    card.querySelector<HTMLSelectElement>(".transfer-sender")?.addEventListener("change", (event) => {
      updateAndRender(() => {
        transfer.senderId = (event.target as HTMLSelectElement).value;
      });
    });
    card.querySelector<HTMLSelectElement>(".transfer-receiver")?.addEventListener("change", (event) => {
      updateAndRender(() => {
        transfer.receiverId = (event.target as HTMLSelectElement).value;
      });
    });
    card.querySelector<HTMLInputElement>(".transfer-date")?.addEventListener("change", (event) => {
      updateAndRender(() => {
        transfer.date = (event.target as HTMLInputElement).value;
      });
    });
    card.querySelector<HTMLInputElement>(".transfer-amount")?.addEventListener("change", (event) => {
      updateAndRender(() => {
        transfer.amount = parseMoney((event.target as HTMLInputElement).value);
      });
    });
  });

  document.querySelector<HTMLInputElement>("#settlement-title")?.addEventListener("input", (event) => {
    state.title = (event.target as HTMLInputElement).value;
    saveState();
  });
  document.querySelector<HTMLInputElement>("#settlement-title")?.addEventListener("change", (event) => {
    updateAndRender(() => {
      state.title = (event.target as HTMLInputElement).value.trim() || "새 정산";
      settingsOpen = true;
    });
  });

  document.querySelectorAll<HTMLElement>(".person-edit").forEach((row) => {
    const person = state.participants.find((item) => item.id === row.dataset.id)!;
    row.querySelector<HTMLInputElement>(".person-name")?.addEventListener("input", (event) => {
      person.name = (event.target as HTMLInputElement).value;
      saveState();
    });
    row.querySelector<HTMLInputElement>(".person-name")?.addEventListener("change", (event) => {
      updateAndRender(() => {
        person.name = (event.target as HTMLInputElement).value.trim() || "이름 없음";
        settingsOpen = true;
      });
    });
    row.querySelector(".delete-person")?.addEventListener("click", () => {
      updateAndRender(() => {
        state.participants = state.participants.filter((item) => item.id !== person.id);
        state.expenses.forEach((expense) => {
          expense.participantIds = expense.participantIds.filter((id) => id !== person.id);
          if (expense.payerId === person.id) expense.payerId = "";
        });
        state.transfers = state.transfers.filter(
          (transfer) => transfer.senderId !== person.id && transfer.receiverId !== person.id,
        );
        settingsOpen = true;
      });
    });
  });

  document.querySelector("#add-person")?.addEventListener("click", () => {
    updateAndRender(() => {
      const person = { id: uid("p"), name: `참여자 ${state.participants.length + 1}` };
      state.participants.push(person);
      state.expenses.forEach((expense) => expense.participantIds.push(person.id));
      settingsOpen = true;
    });
  });

  document.querySelector("#share-settlement")?.addEventListener("click", async () => {
    if (!currentRecord) return;
    const key = formatShareKey(currentRecord.shareKey);
    try {
      await navigator.clipboard.writeText(key);
      window.alert(`참여 키 ${key}를 복사했습니다.`);
    } catch {
      window.prompt("아래 참여 키를 복사해 주세요.", key);
    }
  });

  document.querySelector("#reset-data")?.addEventListener("click", () => {
    if (!window.confirm("현재 입력 내용을 모두 지우고 빈 정산으로 되돌릴까요?")) return;
    state = cloneInitialState();
    saveState();
    settingsOpen = false;
    render();
  });

  document.querySelector("#export-data")?.addEventListener("click", exportData);
  document.querySelector<HTMLInputElement>("#import-data")?.addEventListener("change", importData);
}

function bindHeaderEvents() {
  document.querySelector("#brand-home")?.addEventListener("click", () => void showList());
  document.querySelector("#go-home")?.addEventListener("click", () => void showList());
}

function bindRecordEvents() {
  document.querySelectorAll<HTMLElement>(".settlement-list-card").forEach((card) => {
    const record = records.find((item) => item.id === card.dataset.id);
    if (!record) return;
    card.querySelector(".settlement-open")?.addEventListener("click", () => void openRecord(record.id));
    card.querySelector(".delete-record")?.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `"${record.title}" 정산을 삭제할까요?\n삭제하면 참여자 모두에게서 사라지며 복구할 수 없습니다.`,
      );
      if (!confirmed) return;
      try {
        await deleteSettlement(record);
        records = records.filter((item) => item.id !== record.id);
        renderLanding();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "정산을 삭제하지 못했습니다.");
      }
    });
  });
}

async function openRecord(id: string) {
  renderLoading();
  try {
    const record = await getSettlement(id);
    if (!record) throw new Error("정산을 찾을 수 없거나 접근 권한이 없습니다.");
    currentRecord = record;
    state = structuredClone(record.data);
    settingsOpen = false;
    saveStatus = "saved";
    const url = new URL(window.location.href);
    if (url.searchParams.get("settlement") !== id) {
      url.search = "";
      url.searchParams.set("settlement", id);
      history.pushState({}, "", url);
    }
    render();
    window.scrollTo({ top: 0 });
  } catch (error) {
    renderError(error instanceof Error ? error.message : "정산을 불러오지 못했습니다.");
  }
}

async function showList() {
  window.clearTimeout(saveTimer);
  if (currentRecord && saveStatus === "saving") {
    try {
      await updateSettlement(currentRecord, structuredClone(state));
    } catch {
      // The list can still open; the save indicator has already shown the failure.
    }
  }
  currentRecord = null;
  settingsOpen = false;
  const url = new URL(window.location.href);
  if (url.search) {
    url.search = "";
    history.pushState({}, "", url);
  }
  renderLoading("정산 목록을 불러오는 중이에요");
  try {
    records = await listSettlements();
    renderLanding();
  } catch (error) {
    renderError(error instanceof Error ? error.message : "정산 목록을 불러오지 못했습니다.");
  }
}

function renderError(message: string) {
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    ${renderAppHeader()}
    <main class="center-page">
      <div class="loading-card error-card">
        <span class="loading-icon"><i data-lucide="x"></i></span>
        <h2>문제가 발생했어요</h2>
        <p>${escapeHtml(message)}</p>
        <button class="primary-button" id="error-home">목록으로 돌아가기</button>
      </div>
    </main>
  `;
  createIcons({ icons });
  document.querySelector("#error-home")?.addEventListener("click", () => void showList());
  bindHeaderEvents();
}

async function route() {
  const url = new URL(window.location.href);
  const settlementId = url.searchParams.get("settlement");
  if (settlementId) {
    await openRecord(settlementId);
    return;
  }
  await showList();
}

async function migrateLegacySettlement() {
  const migrationKey = "zizon-legacy-migrated-v1";
  if (localStorage.getItem(migrationKey)) return;
  const legacy = localStorage.getItem("settlement-app-v1");
  if (!legacy) {
    localStorage.setItem(migrationKey, "empty");
    return;
  }

  try {
    const parsed = JSON.parse(legacy) as SettlementData;
    if (
      typeof parsed.title !== "string" ||
      !Array.isArray(parsed.participants) ||
      !Array.isArray(parsed.expenses) ||
      !Array.isArray(parsed.transfers)
    ) {
      throw new Error("Invalid legacy data");
    }
    await createSettlement(parsed);
    localStorage.setItem(migrationKey, "done");
  } catch (error) {
    console.error("기존 정산 이전 실패", error);
  }
}

async function bootstrap() {
  renderLoading();
  await migrateLegacySettlement();
  unsubscribeRealtime();
  unsubscribeRealtime = subscribeToSettlements(() => {
    if (!currentRecord) {
      if (document.querySelector(".action-panel")) return;
      void listSettlements().then((nextRecords) => {
        records = nextRecords;
        renderLanding();
      });
    }
  });
  await route();
}

function closeSettings() {
  settingsOpen = false;
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.title.replace(/\s+/g, "-")}-백업.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importData(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as AppState;
    if (!Array.isArray(parsed.participants) || !Array.isArray(parsed.expenses) || !Array.isArray(parsed.transfers)) {
      throw new Error("invalid");
    }
    state = parsed;
    saveState();
    settingsOpen = false;
    render();
  } catch {
    window.alert("불러올 수 없는 백업 파일입니다.");
  }
}

window.addEventListener("popstate", () => void route());
void bootstrap();
