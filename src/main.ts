import {
  ArrowDownLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDollarSign,
  Download,
  Plus,
  ReceiptText,
  RotateCcw,
  Settings2,
  Trash2,
  Upload,
  Users,
  WalletCards,
  X,
  createIcons,
} from "lucide";
import "./style.css";

type Participant = {
  id: string;
  name: string;
};

type Expense = {
  id: string;
  title: string;
  payerId: string;
  amount: number;
  participantIds: string[];
};

type Transfer = {
  id: string;
  date: string;
  senderId: string;
  receiverId: string;
  amount: number;
};

type AppState = {
  title: string;
  participants: Participant[];
  expenses: Expense[];
  transfers: Transfer[];
};

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

const STORAGE_KEY = "settlement-app-v1";

const icons = {
  ArrowDownLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDollarSign,
  Download,
  Plus,
  ReceiptText,
  RotateCcw,
  Settings2,
  Trash2,
  Upload,
  Users,
  WalletCards,
  X,
};

const initialState: AppState = {
  title: "우리 정산",
  participants: [
    { id: "p1", name: "강주명" },
    { id: "p2", name: "김도영" },
    { id: "p3", name: "김우영" },
    { id: "p4", name: "손승재" },
  ],
  expenses: [
    {
      id: "e1",
      title: "항공권",
      payerId: "p3",
      amount: 1237200,
      participantIds: ["p1", "p2", "p3", "p4"],
    },
    {
      id: "e2",
      title: "숙박비",
      payerId: "",
      amount: 0,
      participantIds: ["p1", "p2", "p3", "p4"],
    },
  ],
  transfers: [
    { id: "t1", date: "", senderId: "p1", receiverId: "p3", amount: 450000 },
    { id: "t2", date: "", senderId: "p4", receiverId: "p3", amount: 250000 },
    { id: "t3", date: "", senderId: "p2", receiverId: "p3", amount: 418700 },
  ],
};

const cloneInitialState = (): AppState => structuredClone(initialState);

let state = loadState();
let settingsOpen = false;

function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as AppState) : cloneInitialState();
  } catch {
    return cloneInitialState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
      <div class="data-actions">
        <button class="text-action" id="export-data"><i data-lucide="download"></i> 백업</button>
        <label class="text-action file-action"><i data-lucide="upload"></i> 불러오기<input id="import-data" type="file" accept="application/json" /></label>
        <button class="text-action danger" id="reset-data"><i data-lucide="rotate-ccw"></i> 초기화</button>
      </div>
    </aside>
  `;
}

function render() {
  const summary = getSummary();
  const settlements = getSettlements(summary);
  const totalExpense = state.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const totalTransferred = state.transfers.reduce((sum, transfer) => sum + transfer.amount, 0);
  const populatedExpenseCount = state.expenses.filter((expense) => expense.amount > 0).length;

  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark"><i data-lucide="circle-dollar-sign"></i></span>
        <div>
          <p>SETTLEMENT</p>
          <h1>${escapeHtml(state.title)}</h1>
        </div>
      </div>
      <button class="settings-button" id="open-settings">
        <i data-lucide="settings-2"></i>
        <span>설정</span>
      </button>
    </header>

    <main>
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

      <p class="autosave-note"><span></span> 변경 내용은 이 기기에 자동 저장됩니다.</p>
    </main>
    ${renderSettings()}
  `;

  createIcons({ icons });
  bindEvents();
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
      state.title = (event.target as HTMLInputElement).value.trim() || "우리 정산";
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

  document.querySelector("#reset-data")?.addEventListener("click", () => {
    if (!window.confirm("현재 입력 내용을 지우고 원본 엑셀 예시로 되돌릴까요?")) return;
    state = cloneInitialState();
    saveState();
    settingsOpen = false;
    render();
  });

  document.querySelector("#export-data")?.addEventListener("click", exportData);
  document.querySelector<HTMLInputElement>("#import-data")?.addEventListener("change", importData);
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

render();
