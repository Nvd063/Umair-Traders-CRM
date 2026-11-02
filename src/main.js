
import "./style.css";

import { auth, db, configured } from "./firebase";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  runTransaction,
  addDoc,
  serverTimestamp,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

import { jsPDF } from "jspdf";

const $ = (selector) => document.querySelector(selector);

const money = (value) =>
  "PKR " +
  Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 2,
  });

const numberText = (value) =>
  Number(value || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 2,
  });

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

const qtyNumber = (value) => {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d+(?:\.\d+)?|\.\d+)(?=\s|[^\d.]|$)/);

  return match ? Number(match[1]) : NaN;
};

const normalizedQty = (item) => {
  const qty = String(item.qty ?? "").trim();

  return item.unit && /^\d+(?:\.\d+)?$/.test(qty)
    ? `${qty} ${item.unit}`
    : qty;
};

const itemAmount = (item) =>
  (qtyNumber(normalizedQty(item)) || 0) *
  Number(item.rate || 0);

const today = () => {
  const date = new Date();
  const local = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000,
  );
  return local.toISOString().slice(0, 10);
};

const state = {
  user: null,
  page: "dashboard",
  invoices: [],
  customers: [],
  editId: null,
  viewId: null,
  items: [],
};

const app = $("#app");

function notice(message, bad = false) {
  const element = $("#notice");
  if (!element) return;

  element.textContent = message;
  element.className = bad ? "notice bad" : "notice";
  element.hidden = false;

  setTimeout(() => {
    if (element.isConnected) element.hidden = true;
  }, 5000);
}

/* AUTHENTICATION */

function login() {
  app.innerHTML = `
    <main class="login-shell">
      <div class="login-card">
        <img class="login-logo"
          src="/assets/logo.png"
          alt="Umair Traders">

        <h1>Welcome back</h1>
        <p>Sign in to manage your invoices and customers.</p>

        ${
          !configured
            ? '<div class="alert">Firebase is not configured yet. Check your .env file.</div>'
            : ""
        }

        <form id="loginForm">
          <label>
            Email address
            <input id="email" type="email" required
              autocomplete="username"
              placeholder="name@example.com">
          </label>

          <label>
            Password
            <input id="password" type="password" required
              autocomplete="current-password"
              placeholder="Enter password">
          </label>

          <button type="submit" class="primary wide"
            ${!configured ? "disabled" : ""}>
            Sign in securely
          </button>
        </form>

        <p class="small">
          Private access • No public registration
        </p>

        <div id="notice" hidden></div>
      </div>
    </main>
  `;

  $("#loginForm").onsubmit = async (event) => {
    event.preventDefault();

    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    button.textContent = "Signing in...";

    try {
      await signInWithEmailAndPassword(
        auth,
        $("#email").value.trim(),
        $("#password").value,
      );
    } catch (error) {
      const messages = {
        "auth/invalid-credential": "Incorrect email or password.",
        "auth/user-disabled": "This account is disabled.",
        "auth/invalid-api-key": "Invalid Firebase API key.",
        "auth/network-request-failed": "Network connection failed.",
        "auth/operation-not-allowed":
          "Email/password login is disabled.",
      };

      notice(messages[error.code] || error.message, true);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = "Sign in securely";
      }
    }
  };
}

/* FIRESTORE */

async function load() {
  const [invoicesSnapshot, customersSnapshot] =
    await Promise.all([
      getDocs(
        query(
          collection(db, "invoices"),
          orderBy("createdAt", "desc"),
        ),
      ),
      getDocs(collection(db, "customers")),
    ]);

  state.invoices = invoicesSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));

  state.customers = customersSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
}

/* APPLICATION */

function shell() {
  const pages = [
    ["dashboard", "▦", "Overview"],
    ["new", "+", "Create Invoice"],
    ["invoices", "▤", "Invoices"],
    ["customers", "♙", "Customers"],
  ];

  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <img src="/assets/logo.png" alt="Umair Traders">
          <span>
            Billing CRM
            <small>Management portal</small>
          </span>
        </div>

        <nav>
          ${pages
            .map(
              ([page, icon, title]) => `
                <button
                  class="nav ${state.page === page ? "active" : ""}"
                  data-page="${page}">
                  <span class="navico">${icon}</span>
                  ${title}
                </button>
              `,
            )
            .join("")}
        </nav>

        <div class="side-bottom">
          Umair Traders<br>
          <small>General Order Supplier</small>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="mobile-menu" id="menu">☰</button>
          <span>
            Umair Traders
            <span class="muted">
              / ${
                state.page === "new"
                  ? "Create Invoice"
                  : state.page.charAt(0).toUpperCase() +
                    state.page.slice(1)
              }
            </span>
          </span>

          <button class="logout" id="logout">
            Log out ↗
          </button>
        </header>

        <main id="content"></main>
      </div>
    </div>

    <div id="notice" hidden></div>
  `;

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.onclick = () => navigate(button.dataset.page);
  });

  $("#logout").onclick = () => signOut(auth);

  $("#menu").onclick = () => {
    $(".sidebar").classList.toggle("open");
  };

  render();
}

function navigate(page) {
  state.page = page;
  state.editId = null;
  state.viewId = null;

  if (page === "new") {
    state.items = [
      { description: "", qty: "1 pcs", rate: 0 },
    ];
  }

  shell();
}

function render() {
  if (state.page === "dashboard") dashboard();
  else if (state.page === "new") editor();
  else if (state.page === "invoices") invoices();
  else if (state.page === "customers") customers();
  else if (state.page === "view") view();
}

/* DASHBOARD */

function dashboard() {
  const sum = state.invoices.reduce(
    (total, invoice) => total + Number(invoice.total || 0),
    0,
  );

  const thisMonth = state.invoices.filter(
    (invoice) =>
      String(invoice.date || "").slice(0, 7) ===
      today().slice(0, 7),
  ).length;

  const stats = [
    ["Total invoices", state.invoices.length, "▤"],
    ["Total billed", money(sum), "₨"],
    ["Customers", state.customers.length, "♙"],
    ["This month", thisMonth, "◷"],
  ];

  $("#content").innerHTML = `
    <div class="heading">
      <div>
        <p class="eyebrow">BUSINESS OVERVIEW</p>
        <h1>Dashboard</h1>
        <p>Keep track of invoices and billing activity.</p>
      </div>
      <button class="primary" id="newBill">
        + Create Invoice
      </button>
    </div>

    <div class="stats">
      ${stats
        .map(
          ([label, value, icon]) => `
            <div class="stat">
              <span>${label}</span>
              <strong>${value}</strong>
              <span class="stat-icon">${icon}</span>
            </div>
          `,
        )
        .join("")}
    </div>

    <section class="panel">
      <div class="panel-title">
        <h2>Recent invoices</h2>
        <button class="link" id="allBills">
          View all →
        </button>
      </div>
      ${invoiceTable(state.invoices.slice(0, 6))}
    </section>
  `;

  $("#newBill").onclick = () => navigate("new");
  $("#allBills").onclick = () => navigate("invoices");
  bindView();
}

function invoiceTable(rows) {
  if (!rows.length) {
    return `
      <div class="empty">
        No invoices yet. Create your first invoice to get started.
      </div>
    `;
  }

  return `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Date</th>
            <th>Amount</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          ${rows
            .map(
              (invoice) => `
                <tr>
                  <td><b>${esc(invoice.number)}</b></td>
                  <td>${esc(invoice.customerName || "Walk-in")}</td>
                  <td>${esc(invoice.date)}</td>
                  <td><b>${money(invoice.total)}</b></td>
                  <td>
                    <button class="link"
                      data-view="${esc(invoice.id)}">
                      View →
                    </button>
                  </td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function bindView() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.onclick = () => {
      state.viewId = button.dataset.view;
      state.page = "view";
      shell();
    };
  });
}

/* INVOICES */

function invoices() {
  $("#content").innerHTML = `
    <div class="heading">
      <div>
        <p class="eyebrow">BILLING RECORDS</p>
        <h1>Invoices</h1>
        <p>Find, review and download your bills.</p>
      </div>
      <button class="primary" id="newBill">
        + New Invoice
      </button>
    </div>

    <section class="panel">
      <div class="toolbar">
        <input id="search"
          placeholder="Search invoice or customer...">
      </div>
      <div id="invoiceList">
        ${invoiceTable(state.invoices)}
      </div>
    </section>
  `;

  $("#newBill").onclick = () => navigate("new");

  $("#search").oninput = (event) => {
    const keyword = event.target.value.toLowerCase();

    const filtered = state.invoices.filter((invoice) =>
      `${invoice.number || ""} ${invoice.customerName || ""}`
        .toLowerCase()
        .includes(keyword),
    );

    $("#invoiceList").innerHTML = invoiceTable(filtered);
    bindView();
  };

  bindView();
}

/* CUSTOMERS */

function customers() {
  $("#content").innerHTML = `
    <div class="heading">
      <div>
        <p class="eyebrow">CONTACT DIRECTORY</p>
        <h1>Customers</h1>
        <p>Save customer details for future invoices.</p>
      </div>
    </div>

    <section class="panel">
      <form id="customerForm" class="customer-form">
        <label>
          Name
          <input id="cname" required
            placeholder="Customer name">
        </label>

        <label>
          Phone
          <input id="cphone" type="tel"
            placeholder="Phone (optional)">
        </label>

        <label>
          Address
          <input id="caddress"
            placeholder="Address (optional)">
        </label>

        <button class="primary">
          Add customer
        </button>
      </form>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>Saved customers</h2>
      </div>

      ${
        state.customers.length
          ? `
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Address</th>
                  </tr>
                </thead>
                <tbody>
                  ${state.customers
                    .map(
                      (customer) => `
                        <tr>
                          <td>${esc(customer.name)}</td>
                          <td>${esc(customer.phone)}</td>
                          <td>${esc(customer.address)}</td>
                        </tr>
                      `,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          : '<div class="empty">No customers added yet.</div>'
      }
    </section>
  `;

  $("#customerForm").onsubmit = async (event) => {
    event.preventDefault();

    const button = event.currentTarget.querySelector("button");
    button.disabled = true;

    try {
      await addDoc(collection(db, "customers"), {
        name: $("#cname").value.trim(),
        phone: $("#cphone").value.trim(),
        address: $("#caddress").value.trim(),
        createdAt: serverTimestamp(),
      });

      await load();
      customers();
      notice("Customer saved");
    } catch (error) {
      notice("Could not save customer: " + error.message, true);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };
}

/* INVOICE EDITOR */

function editor() {
  const existing = state.editId
    ? state.invoices.find((invoice) => invoice.id === state.editId)
    : null;

  if (existing) {
    state.items = existing.items.map((item) => ({
      ...item,
      qty: normalizedQty(item),
    }));
  }

  if (!state.items.length) {
    state.items = [
      { description: "", qty: "1 pcs", rate: 0 },
    ];
  }

  $("#content").innerHTML = `
    <div class="heading">
      <div>
        <p class="eyebrow">BILLING WORKSPACE</p>
        <h1>${existing ? "Edit" : "Create"} Invoice</h1>
        <p>Enter details and generate a professional invoice.</p>
      </div>
      <button class="secondary" id="back">
        ← Back
      </button>
    </div>

    <form id="invoiceForm">
      <section class="panel">
        <div class="panel-title">
          <h2>Invoice details</h2>
        </div>

        <div class="form-grid">
          <label>
            Invoice date
            <input id="date" type="date" required
              value="${esc(existing?.date || today())}">
          </label>

          <label>
            Customer
            <select id="customerSelect">
              <option value="">
                Manual / Walk-in customer
              </option>
              ${state.customers
                .map(
                  (customer) => `
                    <option value="${esc(customer.id)}">
                      ${esc(customer.name)}
                    </option>
                  `,
                )
                .join("")}
            </select>
          </label>

          <label>
            Customer name
            <input id="customerName" required
              value="${esc(existing?.customerName)}"
              placeholder="Customer / company name">
          </label>

          <label>
            Phone
            <input id="customerPhone" type="tel"
              value="${esc(existing?.customerPhone)}"
              placeholder="Optional">
          </label>

          <label class="full">
            Address
            <input id="customerAddress"
              value="${esc(existing?.customerAddress)}"
              placeholder="Customer address (optional)">
          </label>
        </div>
      </section>

      <section class="panel invoice-items-panel">
        <div class="panel-title">
          <h2>Invoice items</h2>
        </div>

        <div class="table-scroll invoice-items-scroll">
          <table class="item-table">
            <thead>
              <tr>
                <th>Item description</th>
                <th>Quantity</th>
                <th>Rate (PKR)</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="itemRows"></tbody>
          </table>
        </div>

        <div class="item-add-actions">
          <button class="secondary" type="button" id="addRow">
            + Add Item
          </button>
        </div>

        <div class="total-row">
          <span>Grand total</span>
          <strong id="total">PKR 0</strong>
        </div>
      </section>

      <section class="panel">
        <div class="form-grid">
          <label>
            Discount (PKR)
            <input id="discount" type="number"
              min="0" step="0.01"
              value="${Number(existing?.discount || 0)}">
          </label>

          <label class="check">
            <input id="stamp" type="checkbox"
              ${existing?.stamp === false ? "" : "checked"}>
            Include authorized stamp
          </label>

          <label class="full">
            Notes
            <textarea id="notes" rows="2"
              placeholder="Optional notes">${esc(existing?.notes)}</textarea>
          </label>
        </div>
      </section>

      <div class="actions">
        <button class="primary" id="saveBtn" type="submit">
          ${existing ? "Save changes" : "Save invoice"}
        </button>
      </div>
    </form>
  `;

  $("#back").onclick = () => navigate("invoices");

  $("#customerSelect").onchange = (event) => {
    const customer = state.customers.find(
      (item) => item.id === event.target.value,
    );

    if (!customer) return;

    $("#customerName").value = customer.name;
    $("#customerPhone").value = customer.phone || "";
    $("#customerAddress").value = customer.address || "";
  };

  $("#addRow").onclick = () => {
    state.items.push({
      description: "",
      qty: "",
      rate: 0,
    });

    drawRows();

    const index = state.items.length - 1;
    const input = document.querySelector(
      `#itemRows [data-i="${index}"][data-k="description"]`,
    );

    if (input) {
      input.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        input.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
      });
    }
  };

  $("#discount").oninput = calc;
  drawRows();
  $("#invoiceForm").onsubmit = saveInvoice;
}

/* MOBILE ITEM ROWS */

function drawRows() {
  const target = $("#itemRows");
  if (!target) return;

  target.innerHTML = state.items
    .map(
      (item, index) => `
        <tr class="invoice-item-row">
          <td class="item-description">
            <div class="mobile-item-heading">
              <strong>Item #${index + 1}</strong>
              <button type="button"
                class="remove mobile-remove"
                data-remove="${index}"
                aria-label="Remove item">×</button>
            </div>

            <label class="mobile-field-label"
              for="item-description-${index}">
              Item Description
            </label>

            <input
              id="item-description-${index}"
              data-i="${index}"
              data-k="description"
              type="text"
              required
              autocomplete="off"
              placeholder="Product / service"
              value="${esc(item.description)}">
          </td>

          <td class="item-quantity">
            <label class="mobile-field-label"
              for="item-qty-${index}">
              Quantity
            </label>

            <input
              id="item-qty-${index}"
              data-i="${index}"
              data-k="qty"
              type="text"
              required
              autocomplete="off"
              placeholder="10 ctn / 5 kg"
              value="${esc(normalizedQty(item))}">
          </td>

          <td class="item-rate">
            <label class="mobile-field-label"
              for="item-rate-${index}">
              Rate (PKR)
            </label>

            <input
              id="item-rate-${index}"
              data-i="${index}"
              data-k="rate"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              required
              placeholder="0"
              value="${esc(item.rate)}">
          </td>

          <td class="item-amount">
            <span class="mobile-field-label">Amount</span>
            <strong class="amount">
              ${money(itemAmount(item))}
            </strong>
          </td>

          <td class="item-remove-cell">
            <button type="button"
              class="remove"
              data-remove="${index}"
              aria-label="Remove item">×</button>
          </td>
        </tr>
      `,
    )
    .join("");

  target.querySelectorAll("[data-k]").forEach((input) => {
    input.oninput = (event) => {
      const { i, k } = event.target.dataset;

      state.items[Number(i)][k] =
        k === "rate"
          ? event.target.value === ""
            ? 0
            : Number(event.target.value)
          : event.target.value;

      calc();
    };
  });

  target.querySelectorAll("[data-remove]").forEach((button) => {
    button.onclick = () => {
      if (state.items.length <= 1) {
        notice("At least one item is required", true);
        return;
      }

      const removedIndex = Number(button.dataset.remove);
      state.items.splice(removedIndex, 1);
      drawRows();

      const nextIndex = Math.min(
        removedIndex,
        state.items.length - 1,
      );

      target
        .querySelector(
          `[data-i="${nextIndex}"][data-k="description"]`,
        )
        ?.focus({ preventScroll: true });
    };
  });

  calc();
}

function calc() {
  let subtotal = 0;

  document.querySelectorAll("#itemRows tr").forEach((row, index) => {
    const item = state.items[index];
    const amount = itemAmount(item);

    subtotal += amount;

    const element = row.querySelector(".amount");
    if (element) element.textContent = money(amount);
  });

  const discount = Number($("#discount")?.value || 0);
  const total = Math.max(0, subtotal - discount);

  const totalElement = $("#total");
  if (totalElement) totalElement.textContent = money(total);
}

/* SAVE INVOICE */

async function saveInvoice(event) {
  event.preventDefault();

  const button = $("#saveBtn");
  button.disabled = true;

  const items = state.items.map((item) => ({
    description: String(item.description || "").trim(),
    qty: normalizedQty(item),
    rate: Number(item.rate),
  }));

  const invalid = items.some(
    (item) =>
      !item.description ||
      !(qtyNumber(item.qty) > 0) ||
      item.rate < 0 ||
      !Number.isFinite(item.rate),
  );

  if (invalid) {
    notice("Check item descriptions, quantities and rates", true);
    button.disabled = false;
    return;
  }

  const subtotal = items.reduce(
    (sum, item) => sum + itemAmount(item),
    0,
  );

  const discount = Number($("#discount").value || 0);

  if (
    !Number.isFinite(discount) ||
    discount < 0 ||
    discount > subtotal
  ) {
    notice("Enter a valid discount not exceeding subtotal", true);
    button.disabled = false;
    return;
  }

  const data = {
    date: $("#date").value,
    customerName: $("#customerName").value.trim(),
    customerPhone: $("#customerPhone").value.trim(),
    customerAddress: $("#customerAddress").value.trim(),
    items,
    subtotal,
    discount,
    total: subtotal - discount,
    stamp: $("#stamp").checked,
    notes: $("#notes").value.trim(),
    updatedAt: serverTimestamp(),
  };

  try {
    if (state.editId) {
      await updateDoc(
        doc(db, "invoices", state.editId),
        data,
      );

      state.viewId = state.editId;
    } else {
      const invoiceRef = doc(collection(db, "invoices"));

      await runTransaction(db, async (transaction) => {
        const counterRef = doc(db, "counters", "invoices");
        const snapshot = await transaction.get(counterRef);

        const next =
          (snapshot.exists()
            ? Number(snapshot.data().last || 0)
            : 0) + 1;

        transaction.set(counterRef, { last: next });

        transaction.set(invoiceRef, {
          ...data,
          number: `UT-${String(next).padStart(5, "0")}`,
          createdAt: serverTimestamp(),
          createdBy: state.user.uid,
        });
      });

      state.viewId = invoiceRef.id;
    }

    await load();

    state.page = "view";
    state.editId = null;

    shell();
    notice("Invoice saved successfully");
  } catch (error) {
    notice("Could not save invoice: " + error.message, true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

/* INVOICE HTML PREVIEW */

function invoiceHTML(invoice) {
  return `
    <article class="paper" id="paper">
      <div class="paper-top">
        <img class="paper-logo"
          src="/assets/logo.png"
          alt="Umair Traders">

        <div class="paper-heading">
          <b>INVOICE</b>
          <span>${esc(invoice.number)}</span>
        </div>
      </div>

      <div class="paper-rule"></div>

      <div class="paper-meta">
        <div>
          <small>BILL TO</small>
          <strong>${esc(invoice.customerName || "Walk-in Customer")}</strong>
          ${
            invoice.customerPhone
              ? `<span>${esc(invoice.customerPhone)}</span>`
              : ""
          }
          ${
            invoice.customerAddress
              ? `<span>${esc(invoice.customerAddress)}</span>`
              : ""
          }
        </div>

        <div class="right">
          <small>INVOICE DATE</small>
          <strong>${esc(invoice.date)}</strong>
          <span>Currency: PKR</span>
        </div>
      </div>

      <table class="paper-table">
        <thead>
          <tr>
            <th>#</th>
            <th>DESCRIPTION</th>
            <th>QUANTITY</th>
            <th>RATE</th>
            <th>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          ${(invoice.items || [])
            .map(
              (item, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${esc(item.description)}</td>
                  <td>${esc(normalizedQty(item))}</td>
                  <td>${numberText(item.rate)}</td>
                  <td>${numberText(itemAmount(item))}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>

      <div class="paper-totals">
        <div>
          <span>Subtotal</span>
          <b>${money(invoice.subtotal)}</b>
        </div>
        ${
          invoice.discount
            ? `
              <div>
                <span>Discount</span>
                <b>− ${money(invoice.discount)}</b>
              </div>
            `
            : ""
        }
        <div class="paper-grand">
          <span>GRAND TOTAL</span>
          <b>${money(invoice.total)}</b>
        </div>
      </div>

      ${
        invoice.notes
          ? `
            <div class="paper-notes">
              <small>NOTES</small>
              <p>${esc(invoice.notes)}</p>
            </div>
          `
          : ""
      }

      <div class="paper-sign">
        <div>
          ${
            invoice.stamp !== false
              ? '<img src="/assets/stamp.png" alt="Authorized business stamp">'
              : ""
          }
          <span>Authorized Signature / Stamp</span>
        </div>
      </div>

      <footer class="paper-footer">
        <b>UMAIR TRADERS</b>
        <span>
          27-E, Gulberg Main Market, Lahore
          &nbsp; | &nbsp;
          +92-309-9444429
        </span>
      </footer>
    </article>
  `;
}

/* PROFESSIONAL MULTI-PAGE PDF GENERATOR */

const PDF_CONFIG = {
  width: 210,
  height: 297,
  left: 15,
  right: 195,
  top: 14,
  bottom: 282,
  navy: [23, 62, 107],
  ink: [23, 33, 47],
  muted: [55, 70, 89],
  light: [232, 239, 247],
  line: [211, 220, 231],
};

function setPDFColor(pdf, rgb) {
  pdf.setTextColor(...rgb);
}

function pdfText(pdf, value, x, y, options = {}) {
  pdf.text(String(value ?? ""), x, y, options);
}

function loadImageData(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;

        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);

        resolve({
          data: canvas.toDataURL("image/png"),
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      } catch {
        resolve(null);
      }
    };

    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function fitImage(image, x, y, maxW, maxH) {
  const ratio = Math.min(
    maxW / image.width,
    maxH / image.height,
  );

  return {
    x,
    y,
    width: image.width * ratio,
    height: image.height * ratio,
  };
}

function drawPDFHeader(pdf, invoice, logo, pageIndex) {
  const C = PDF_CONFIG;

  if (logo) {
    const size = fitImage(logo, 15, 12, 43, 30);
    pdf.addImage(
      logo.data,
      "PNG",
      size.x,
      size.y,
      size.width,
      size.height,
    );
  } else {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(17);
    setPDFColor(pdf, C.ink);
    pdfText(pdf, "UMAIR TRADERS", 15, 26);
    pdf.setFontSize(8);
    pdfText(pdf, "GENERAL ORDER SUPPLIER", 15, 32);
  }

  setPDFColor(pdf, C.navy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(19);
  pdfText(pdf, "INVOICE", 195, 22, {
    align: "right",
  });

  pdf.setFontSize(9);
  pdfText(pdf, invoice.number || "", 195, 29, {
    align: "right",
  });

  pdf.setDrawColor(...C.navy);
  pdf.setLineWidth(0.55);
  pdf.line(15, 45, 195, 45);

  setPDFColor(pdf, C.muted);
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "bold");
  pdfText(pdf, "BILL TO", 15, 53);

  pdfText(pdf, "INVOICE DATE", 195, 53, {
    align: "right",
  });

  setPDFColor(pdf, C.ink);
  pdf.setFontSize(10);
  pdfText(
    pdf,
    invoice.customerName || "Walk-in Customer",
    15,
    59,
  );

  pdfText(pdf, invoice.date || "", 195, 59, {
    align: "right",
  });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.2);

  let detailY = 64;

  if (invoice.customerPhone) {
    pdfText(pdf, invoice.customerPhone, 15, detailY);
    detailY += 4.5;
  }

  if (invoice.customerAddress) {
    const addressLines = pdf.splitTextToSize(
      invoice.customerAddress,
      112,
    ).slice(0, 3);

    addressLines.forEach((line) => {
      pdfText(pdf, line, 15, detailY);
      detailY += 4.5;
    });
  }

  pdfText(pdf, "Currency: PKR", 195, 65, {
    align: "right",
  });

  if (pageIndex > 0) {
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(7);
    setPDFColor(pdf, C.muted);
    pdfText(pdf, "Continued invoice", 195, 71, {
      align: "right",
    });
  }

  return Math.max(78, detailY + 6);
}

function drawPDFTableHeader(pdf, y) {
  const C = PDF_CONFIG;

  pdf.setFillColor(...C.navy);
  pdf.rect(15, y, 180, 9, "F");

  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);

  pdfText(pdf, "#", 18, y + 5.8);
  pdfText(pdf, "DESCRIPTION", 29, y + 5.8);
  pdfText(pdf, "QUANTITY", 111, y + 5.8);
  pdfText(pdf, "RATE", 162, y + 5.8, {
    align: "right",
  });
  pdfText(pdf, "AMOUNT", 192, y + 5.8, {
    align: "right",
  });

  return y + 9;
}

function measurePDFRow(pdf, item) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.7);

  const descriptionLines = pdf.splitTextToSize(
    String(item.description || ""),
    75,
  );

  const qtyLines = pdf.splitTextToSize(
    normalizedQty(item),
    37,
  );

  const lineCount = Math.max(
    descriptionLines.length,
    qtyLines.length,
    1,
  );

  return {
    descriptionLines,
    qtyLines,
    height: Math.max(7.1, lineCount * 4.2 + 2.8),
  };
}

function drawPDFRow(pdf, item, index, y, measured) {
  const C = PDF_CONFIG;

  setPDFColor(pdf, C.ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);

  pdfText(pdf, index + 1, 18, y + 4.8);
  pdf.text(measured.descriptionLines, 29, y + 4.8);
  pdf.text(measured.qtyLines, 111, y + 4.8);

  pdfText(pdf, numberText(item.rate), 162, y + 4.8, {
    align: "right",
  });

  pdfText(
    pdf,
    numberText(itemAmount(item)),
    192,
    y + 4.8,
    { align: "right" },
  );

  pdf.setDrawColor(...C.line);
  pdf.setLineWidth(0.15);
  pdf.line(15, y + measured.height, 195, y + measured.height);

  return y + measured.height;
}

function drawPDFFooter(pdf, pageNumber, totalPages) {
  const C = PDF_CONFIG;

  pdf.setDrawColor(...C.line);
  pdf.setLineWidth(0.25);
  pdf.line(15, 281, 195, 281);

  setPDFColor(pdf, C.ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.3);
  pdfText(pdf, "UMAIR TRADERS", 15, 286);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdfText(
    pdf,
    "27-E, Gulberg Main Market, Lahore | +92-309-9444429",
    195,
    286,
    { align: "right" },
  );

  setPDFColor(pdf, C.muted);
  pdf.setFontSize(6.8);
  pdfText(
    pdf,
    `Page ${pageNumber} of ${totalPages}`,
    195,
    292,
    { align: "right" },
  );
}

function drawPDFFinalSection(pdf, invoice, y, stamp) {
  const C = PDF_CONFIG;

  const totalX = 117;
  const totalW = 78;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  setPDFColor(pdf, C.ink);

  pdfText(pdf, "Subtotal", totalX + 3, y + 7);
  pdfText(
    pdf,
    money(invoice.subtotal),
    totalX + totalW - 3,
    y + 7,
    { align: "right" },
  );

  y += 10;

  if (Number(invoice.discount) > 0) {
    pdfText(pdf, "Discount", totalX + 3, y + 6);
    pdfText(
      pdf,
      "- " + money(invoice.discount),
      totalX + totalW - 3,
      y + 6,
      { align: "right" },
    );
    y += 9;
  }

  pdf.setFillColor(...C.light);
  pdf.setDrawColor(...C.navy);
  pdf.setLineWidth(0.45);
  pdf.line(totalX, y, 195, y);

  pdf.rect(totalX, y, totalW, 11, "F");

  setPDFColor(pdf, C.navy);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9.2);
  pdfText(pdf, "GRAND TOTAL", totalX + 3, y + 7);

  pdfText(
    pdf,
    money(invoice.total),
    192,
    y + 7,
    { align: "right" },
  );

  y += 16;

  if (invoice.notes) {
    setPDFColor(pdf, C.muted);
    pdf.setFontSize(8);
    pdfText(pdf, "NOTES", 15, y + 3);

    pdf.setFont("helvetica", "normal");
    setPDFColor(pdf, C.ink);

    const lines = pdf.splitTextToSize(
      String(invoice.notes),
      105,
    );

    pdf.text(lines, 15, y + 8);
  }

  const signatureLineY = Math.max(y + 25, 265);

  if (invoice.stamp !== false && stamp) {
    const fitted = fitImage(
      stamp,
      151,
      signatureLineY - 29,
      28,
      26,
    );

    pdf.addImage(
      stamp.data,
      "PNG",
      fitted.x,
      fitted.y,
      fitted.width,
      fitted.height,
    );
  }

  pdf.setDrawColor(90, 106, 126);
  pdf.setLineWidth(0.25);
  pdf.line(145, signatureLineY, 195, signatureLineY);

  setPDFColor(pdf, C.ink);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdfText(
    pdf,
    "Authorized Signature / Stamp",
    170,
    signatureLineY + 4,
    { align: "center" },
  );
}

async function generateInvoicePDF(invoice) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const [logo, stamp] = await Promise.all([
    loadImageData("/assets/logo.png"),
    loadImageData("/assets/stamp.png"),
  ]);

  const items = invoice.items || [];

  const pages = [];
  let page = [];
  let currentHeight = 0;

  // A4 content region, excluding header and footer.
  // 25 standard single-line rows fit comfortably.
  const MAX_ROWS_PER_PAGE = 25;
  const MAX_ROW_HEIGHT = 176;

  items.forEach((item, index) => {
    const measured = measurePDFRow(pdf, item);

    const exceedsRows = page.length >= MAX_ROWS_PER_PAGE;
    const exceedsHeight =
      currentHeight + measured.height > MAX_ROW_HEIGHT;

    if (page.length && (exceedsRows || exceedsHeight)) {
      pages.push(page);
      page = [];
      currentHeight = 0;
    }

    page.push({ item, index, measured });
    currentHeight += measured.height;
  });

  if (page.length || !pages.length) {
    pages.push(page);
  }

  // Reserve the final section on the last page.
  const finalPage = pages[pages.length - 1];

  const finalRowsHeight = finalPage.reduce(
    (sum, entry) => sum + entry.measured.height,
    0,
  );

  const notesLines = invoice.notes
    ? pdf.splitTextToSize(String(invoice.notes), 105).length
    : 0;

  const finalSectionHeight =
    58 +
    (Number(invoice.discount) > 0 ? 9 : 0) +
    notesLines * 4.2;

  // Header/table starts at approximately 87 mm.
  const finalAvailableHeight = 265 - 87;

  while (
    finalPage.length > 1 &&
    finalPage.reduce(
      (sum, entry) => sum + entry.measured.height,
      0,
    ) +
      finalSectionHeight >
      finalAvailableHeight
  ) {
    const moved = finalPage.shift();

    if (pages.length === 1) {
      pages.unshift([moved]);
    } else {
      pages[pages.length - 2].push(moved);
    }
  }

  // If the final page still has insufficient room,
  // put totals/signature on a dedicated final page.
  let separateFinalPage = false;

  const remainingHeight = finalPage.reduce(
    (sum, entry) => sum + entry.measured.height,
    0,
  );

  if (
    remainingHeight + finalSectionHeight >
    finalAvailableHeight
  ) {
    separateFinalPage = true;
  }

  const totalPages =
    pages.length + (separateFinalPage ? 1 : 0);

  pages.forEach((entries, pageIndex) => {
    if (pageIndex > 0) pdf.addPage();

    let y = drawPDFHeader(
      pdf,
      invoice,
      logo,
      pageIndex,
    );

    y = drawPDFTableHeader(pdf, y);

    entries.forEach(({ item, index, measured }) => {
      y = drawPDFRow(
        pdf,
        item,
        index,
        y,
        measured,
      );
    });

    if (
      pageIndex === pages.length - 1 &&
      !separateFinalPage
    ) {
      drawPDFFinalSection(
        pdf,
        invoice,
        y + 5,
        stamp,
      );
    }

    drawPDFFooter(
      pdf,
      pageIndex + 1,
      totalPages,
    );
  });

  if (separateFinalPage) {
    pdf.addPage();

    const y = drawPDFHeader(
      pdf,
      invoice,
      logo,
      pages.length,
    );

    drawPDFFinalSection(
      pdf,
      invoice,
      y + 12,
      stamp,
    );

    drawPDFFooter(
      pdf,
      totalPages,
      totalPages,
    );
  }

  return pdf;
}

/* VIEW / DOWNLOAD / PRINT */

function view() {
  const invoice = state.invoices.find(
    (item) => item.id === state.viewId,
  );

  if (!invoice) {
    navigate("invoices");
    return;
  }

  $("#content").innerHTML = `
    <div class="heading">
      <div>
        <p class="eyebrow">INVOICE DETAILS</p>
        <h1>${esc(invoice.number)}</h1>
        <p>Review, print or download this invoice.</p>
      </div>
      <button class="secondary" id="back">
        ← All invoices
      </button>
    </div>

    <div class="invoice-actions">
      <button class="primary" id="download">
        ↓ Download PDF
      </button>

      <button class="secondary" id="print">
        Print
      </button>

      <button class="secondary" id="edit">
        Edit
      </button>

      <button class="secondary" id="duplicate">
        Duplicate
      </button>

      <button class="danger" id="delete">
        Delete
      </button>
    </div>

    <div class="paper-wrap">
      ${invoiceHTML(invoice)}
    </div>
  `;

  $("#back").onclick = () => navigate("invoices");

  $("#print").onclick = async () => {
    const button = $("#print");
    button.disabled = true;

    try {
      const pdf = await generateInvoicePDF(invoice);
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url, "_blank");

      if (!printWindow) {
        notice(
          "Pop-up blocked. Download the PDF and print it.",
          true,
        );
      }

      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      notice("Print preparation failed: " + error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  $("#edit").onclick = () => {
    state.editId = invoice.id;
    state.page = "new";
    shell();
  };

  $("#duplicate").onclick = () => {
    state.editId = null;
    state.page = "new";

    shell();

    state.items = invoice.items.map((item) => ({
      ...item,
      qty: normalizedQty(item),
    }));

    drawRows();

    $("#customerName").value = invoice.customerName || "";
    $("#customerPhone").value = invoice.customerPhone || "";
    $("#customerAddress").value = invoice.customerAddress || "";
    $("#discount").value = invoice.discount || 0;
    $("#notes").value = invoice.notes || "";
    $("#stamp").checked = invoice.stamp !== false;

    calc();
  };

  $("#delete").onclick = async () => {
    if (!confirm("Permanently delete this invoice?")) return;

    try {
      await deleteDoc(doc(db, "invoices", invoice.id));
      await load();
      navigate("invoices");
      notice("Invoice deleted");
    } catch (error) {
      notice(error.message, true);
    }
  };

  $("#download").onclick = async () => {
    const button = $("#download");
    button.disabled = true;
    button.textContent = "Generating PDF...";

    try {
      const pdf = await generateInvoicePDF(invoice);
      pdf.save(`${invoice.number}.pdf`);
    } catch (error) {
      console.error("PDF generation:", error);
      notice(
        "PDF generation failed: " + error.message,
        true,
      );
    } finally {
      button.disabled = false;
      button.textContent = "↓ Download PDF";
    }
  };
}

/* FIREBASE AUTHORIZATION */

if (!configured) {
  login();
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      state.user = null;
      login();
      return;
    }

    try {
      const access = await getDoc(
        doc(db, "authorizedUsers", user.uid),
      );

      if (
        !access.exists() ||
        access.data()?.active !== true
      ) {
        await signOut(auth);
        state.user = null;
        login();

        notice(
          "Account is not authorized or inactive.",
          true,
        );
        return;
      }

      state.user = user;

      await load();

      state.page = "dashboard";
      shell();
    } catch (error) {
      console.error("CRM initialization error:", error);

      login();

      notice(
        "Unable to load CRM: " +
          (error.code || "") +
          " " +
          error.message,
        true,
      );
    }
  });
}
