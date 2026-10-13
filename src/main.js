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
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
const $ = (s) => document.querySelector(s);
const money = (n) =>
  "PKR " + Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 });
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const today = () => new Date().toLocaleDateString("en-CA");
const state = {
  user: null,
  page: "dashboard",
  invoices: [],
  customers: [],
  editId: null,
  viewId: null,
  items: [],
  stamp: true,
};
const app = $("#app");
function notice(msg, bad = false) {
  const e = $("#notice");
  if (e) {
    e.textContent = msg;
    e.className = bad ? "notice bad" : "notice";
    e.hidden = false;
    setTimeout(() => (e.hidden = true), 5000);
  }
}

function login() {
  app.innerHTML = `
    <main class="login-shell">
      <div class="login-card">
        <img class="login-logo" src="/assets/logo.png" alt="Umair Traders">
        <h1>Welcome back</h1>
        <p>Sign in to manage your invoices and customers.</p>

        ${!configured
          ? '<div class="alert">Firebase is not configured yet. Check your .env file.</div>'
          : ""}

        <form id="loginForm">
          <label>Email address
            <input type="email" id="email" required
              autocomplete="username" placeholder="name@example.com">
          </label>

          <label>Password
            <input type="password" id="password" required
              autocomplete="current-password" placeholder="Enter password">
          </label>

          <button type="submit" class="primary wide"
            ${!configured ? "disabled" : ""}>
            Sign in securely
          </button>
        </form>

        <p class="small">Private access • No public registration</p>
        <div id="notice" hidden></div>
      </div>
    </main>
  `;

  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();

    console.log("STEP 1: Login button clicked");

    const button = e.currentTarget.querySelector("button");
    button.disabled = true;
    button.textContent = "Signing in...";

    try {
      console.log("STEP 2: Connecting to Firebase...");

      const result = await signInWithEmailAndPassword(
        auth,
        $("#email").value.trim(),
        $("#password").value
      );

      console.log("STEP 3: Firebase login successful");
      console.log("User UID:", result.user.uid);

      // Existing onAuthStateChanged listener should
      // handle authorization and dashboard navigation.

    } catch (err) {
      console.error("FIREBASE LOGIN ERROR:", err.code, err.message);

      const errorMessage = {
        "auth/invalid-credential": "Incorrect email or password.",
        "auth/user-disabled": "This account has been disabled.",
        "auth/invalid-api-key": "Invalid Firebase API key.",
        "auth/network-request-failed": "Network connection failed.",
        "auth/operation-not-allowed": "Email/password login is not enabled."
      };

      notice(
        errorMessage[err.code] || err.message || "Login failed.",
        true
      );

    } finally {
      button.disabled = false;
      button.textContent = "Sign in securely";
    }
  };
}


async function load() {
  const [a, b] = await Promise.all([
    getDocs(query(collection(db, "invoices"), orderBy("createdAt", "desc"))),
    getDocs(collection(db, "customers")),
  ]);
  state.invoices = a.docs.map((d) => ({ id: d.id, ...d.data() }));
  state.customers = b.docs.map((d) => ({ id: d.id, ...d.data() }));
}
function shell() {
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand"><img src="/assets/logo.png" alt="Umair Traders"><span>Billing CRM<small>Management portal</small></span></div><nav>${[
    ["dashboard", "layout-dashboard", "Overview"],
    ["new", "file-plus", "Create Invoice"],
    ["invoices", "files", "Invoices"],
    ["customers", "users", "Customers"],
  ]
    .map(
      ([p, ic, t]) =>
        `<button class="nav ${state.page === p ? "active" : ""}" data-page="${p}"><span class="navico">${p === "dashboard" ? "▦" : p === "new" ? "+" : p === "invoices" ? "▤" : "♙"}</span>${t}</button>`,
    )
    .join(
      "",
    )}</nav><div class="side-bottom">Umair Traders<br><small>Hardware & Sanitary Store</small></div></aside><div class="main"><header class="topbar"><button class="mobile-menu" id="menu">☰</button><span>Umair Traders <span class="muted">/ ${state.page === "new" ? "Create Invoice" : state.page[0].toUpperCase() + state.page.slice(1)}</span></span><button class="logout" id="logout">Log out ↗</button></header><main id="content"></main></div></div><div id="notice" hidden></div>`;
  document
    .querySelectorAll("[data-page]")
    .forEach((b) => (b.onclick = () => navigate(b.dataset.page)));
  $("#logout").onclick = () => signOut(auth);
  $("#menu").onclick = () => $(".sidebar").classList.toggle("open");
  render();
}
function navigate(p) {
  state.page = p;
  state.editId = null;
  state.viewId = null;
  if (p === "new")
    state.items = [{ description: "", qty: 1, unit: "pcs", rate: 0 }];
  shell();
}
function render() {
  if (state.page === "dashboard") dashboard();
  else if (state.page === "new") editor();
  else if (state.page === "invoices") invoices();
  else if (state.page === "customers") customers();
  else if (state.page === "view") view();
}
function dashboard() {
  const sum = state.invoices.reduce((a, i) => a + Number(i.total || 0), 0);
  $("#content").innerHTML =
    `<div class="heading"><div><p class="eyebrow">BUSINESS OVERVIEW</p><h1>Dashboard</h1><p>Keep track of invoices and billing activity.</p></div><button class="primary" id="newBill">+ Create Invoice</button></div><div class="stats">${[
      ["Total invoices", state.invoices.length, "▤"],
      ["Total billed", money(sum), "₨"],
      ["Customers", state.customers.length, "♙"],
      [
        "This month",
        state.invoices.filter(
          (i) => String(i.date || "").slice(0, 7) === today().slice(0, 7),
        ).length,
        "◷",
      ],
    ]
      .map(
        ([l, v, ic]) =>
          `<div class="stat"><span>${l}</span><strong>${v}</strong><span class="stat-icon">${ic}</span></div>`,
      )
      .join(
        "",
      )}</div><section class="panel"><div class="panel-title"><h2>Recent invoices</h2><button class="link" id="allBills">View all →</button></div>${invoiceTable(state.invoices.slice(0, 6))}</section>`;
  $("#newBill").onclick = () => navigate("new");
  $("#allBills").onclick = () => navigate("invoices");
  bindView();
}
function invoiceTable(rows) {
  return rows.length
    ? `<div class="table-scroll"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Amount</th><th></th></tr></thead><tbody>${rows.map((i) => `<tr><td><b>${esc(i.number)}</b></td><td>${esc(i.customerName || "Walk-in")}</td><td>${esc(i.date)}</td><td><b>${money(i.total)}</b></td><td><button class="link" data-view="${esc(i.id)}">View →</button></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty">No invoices yet. Create your first invoice to get started.</div>';
}
function bindView() {
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        state.viewId = b.dataset.view;
        state.page = "view";
        shell();
      }),
  );
}
function invoices() {
  const c = $("#content");
  c.innerHTML = `<div class="heading"><div><p class="eyebrow">BILLING RECORDS</p><h1>Invoices</h1><p>Find, review and download your bills.</p></div><button class="primary" id="newBill">+ New Invoice</button></div><section class="panel"><div class="toolbar"><input id="search" placeholder="Search invoice or customer..."></div><div id="invoiceList">${invoiceTable(state.invoices)}</div></section>`;
  $("#newBill").onclick = () => navigate("new");
  $("#search").oninput = (e) => {
    $("#invoiceList").innerHTML = invoiceTable(
      state.invoices.filter((i) =>
        (i.number + " " + i.customerName)
          .toLowerCase()
          .includes(e.target.value.toLowerCase()),
      ),
    );
    bindView();
  };
  bindView();
}
function customers() {
  const c = $("#content");
  c.innerHTML = `<div class="heading"><div><p class="eyebrow">CONTACT DIRECTORY</p><h1>Customers</h1><p>Save customer details for future invoices.</p></div></div><section class="panel"><form id="customerForm" class="customer-form"><label>Name<input id="cname" required placeholder="Customer name"></label><label>Phone<input id="cphone" placeholder="Phone (optional)"></label><label>Address<input id="caddress" placeholder="Address (optional)"></label><button class="primary">Add customer</button></form></section><section class="panel"><div class="panel-title"><h2>Saved customers</h2></div>${state.customers.length ? `<div class="table-scroll"><table><thead><tr><th>Name</th><th>Phone</th><th>Address</th></tr></thead><tbody>${state.customers.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.phone)}</td><td>${esc(x.address)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No customers added yet.</div>'}</section>`;
  $("#customerForm").onsubmit = async (e) => {
    e.preventDefault();
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
    } catch (e) {
      notice("Could not save customer: " + e.message, true);
    }
  };
}
function editor() {
  const existing = state.editId
    ? state.invoices.find((x) => x.id === state.editId)
    : null;
  if (existing) state.items = existing.items.map((x) => ({ ...x }));
  const c = $("#content");
  c.innerHTML = `<div class="heading"><div><p class="eyebrow">BILLING WORKSPACE</p><h1>${existing ? "Edit" : "Create"} Invoice</h1><p>Enter details and generate a professional invoice.</p></div><button class="secondary" id="back">← Back</button></div><form id="invoiceForm"><section class="panel"><div class="panel-title"><h2>Invoice details</h2></div><div class="form-grid"><label>Invoice date<input id="date" type="date" required value="${esc(existing?.date || today())}"></label><label>Customer<select id="customerSelect"><option value="">Manual / Walk-in customer</option>${state.customers.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select></label><label>Customer name<input id="customerName" required value="${esc(existing?.customerName)}" placeholder="Customer / company name"></label><label>Phone<input id="customerPhone" value="${esc(existing?.customerPhone)}" placeholder="Optional"></label><label class="full">Address<input id="customerAddress" value="${esc(existing?.customerAddress)}" placeholder="Customer address (optional)"></label></div></section><section class="panel"><div class="panel-title"><h2>Invoice items</h2><button class="secondary" type="button" id="addRow">+ Add item</button></div><div class="table-scroll"><table class="item-table"><thead><tr><th>Item description</th><th>Qty</th><th>Unit</th><th>Rate (PKR)</th><th>Amount</th><th></th></tr></thead><tbody id="itemRows"></tbody></table></div><div class="total-row"><span>Grand total</span><strong id="total">PKR 0</strong></div></section><section class="panel"><div class="form-grid"><label>Discount (PKR)<input id="discount" type="number" min="0" step="0.01" value="${Number(existing?.discount || 0)}"></label><label class="check"><input type="checkbox" id="stamp" ${existing?.stamp === false ? "" : "checked"}> Include authorized stamp</label><label class="full">Notes<textarea id="notes" rows="2" placeholder="Optional notes">${esc(existing?.notes)}</textarea></label></div></section><div class="actions"><button class="primary" id="saveBtn">${existing ? "Save changes" : "Save invoice"}</button></div></form>`;
  $("#back").onclick = () => navigate("invoices");
  $("#customerSelect").onchange = (e) => {
    const x = state.customers.find((v) => v.id === e.target.value);
    if (x) {
      $("#customerName").value = x.name;
      $("#customerPhone").value = x.phone || "";
      $("#customerAddress").value = x.address || "";
    }
  };
  $("#addRow").onclick = () => {
    state.items.push({ description: "", qty: 1, unit: "pcs", rate: 0 });
    drawRows();
  };
  $("#discount").oninput = calc;
  drawRows();
  $("#invoiceForm").onsubmit = saveInvoice;
}
function drawRows() {
  const target = $("#itemRows");
  target.innerHTML = state.items
    .map(
      (x, i) =>
        `<tr><td><input data-i="${i}" data-k="description" required placeholder="Product / service" value="${esc(x.description)}"></td><td><input data-i="${i}" data-k="qty" type="number" min="0.001" step="any" required value="${esc(x.qty)}"></td><td><input data-i="${i}" data-k="unit" value="${esc(x.unit)}" placeholder="pcs / kg"></td><td><input data-i="${i}" data-k="rate" type="number" min="0" step="any" required value="${esc(x.rate)}"></td><td class="amount">${money(x.qty * x.rate)}</td><td><button type="button" class="remove" data-remove="${i}" title="Remove item">×</button></td></tr>`,
    )
    .join("");
  target.querySelectorAll("[data-k]").forEach(
    (el) =>
      (el.oninput = (e) => {
        const { i, k } = e.target.dataset;
        state.items[Number(i)][k] = ["qty", "rate"].includes(k)
          ? Number(e.target.value)
          : e.target.value;
        calc();
      }),
  );
  target.querySelectorAll("[data-remove]").forEach(
    (el) =>
      (el.onclick = () => {
        if (state.items.length <= 1)
          return notice("At least one item is required", true);
        state.items.splice(Number(el.dataset.remove), 1);
        drawRows();
      }),
  );
  calc();
}
function calc() {
  let sum = 0;
  $("#itemRows")
    .querySelectorAll("tr")
    .forEach((tr, i) => {
      const x = state.items[i];
      const a = Number(x.qty || 0) * Number(x.rate || 0);
      sum += a;
      tr.querySelector(".amount").textContent = money(a);
    });
  $("#total").textContent = money(
    Math.max(0, sum - Number($("#discount").value || 0)),
  );
}
async function saveInvoice(e) {
  e.preventDefault();
  const btn = $("#saveBtn");
  btn.disabled = true;
  const items = state.items.map((x) => ({
    description: String(x.description).trim(),
    qty: Number(x.qty),
    unit: String(x.unit || "pcs").trim(),
    rate: Number(x.rate),
  }));
  if (
    items.some(
      (x) =>
        !x.description ||
        !(x.qty > 0) ||
        x.rate < 0 ||
        !Number.isFinite(x.rate),
    )
  ) {
    notice("Check item descriptions, quantities and rates", true);
    btn.disabled = false;
    return;
  }
  const subtotal = items.reduce((a, x) => a + x.qty * x.rate, 0);
  const discount = Number($("#discount").value || 0);
  if (discount > subtotal) {
    notice("Discount cannot exceed subtotal", true);
    btn.disabled = false;
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
      await updateDoc(doc(db, "invoices", state.editId), data);
      state.viewId = state.editId;
    } else {
      const ref = doc(collection(db, "invoices"));
      await runTransaction(db, async (tx) => {
        const counter = doc(db, "counters", "invoices");
        const snapshot = await tx.get(counter);
        const next =
          (snapshot.exists() ? Number(snapshot.data().last || 0) : 0) + 1;
        tx.set(counter, { last: next });
        tx.set(ref, {
          ...data,
          number: `UT-${String(next).padStart(5, "0")}`,
          createdAt: serverTimestamp(),
          createdBy: state.user.uid,
        });
      });
      state.viewId = ref.id;
    }
    await load();
    state.page = "view";
    state.editId = null;
    shell();
    notice("Invoice saved successfully");
  } catch (err) {
    notice("Could not save invoice: " + err.message, true);
  } finally {
    btn.disabled = false;
  }
}
function invoiceHTML(i) {
  return `<article class="paper" id="paper"><div class="paper-top"><img class="paper-logo" src="/assets/logo.png" alt="Umair Traders"><div class="paper-heading"><b>INVOICE</b><span>${esc(i.number)}</span></div></div><div class="paper-rule"></div><div class="paper-meta"><div><small>BILL TO</small><strong>${esc(i.customerName || "Walk-in Customer")}</strong>${i.customerPhone ? `<span>${esc(i.customerPhone)}</span>` : ""}${i.customerAddress ? `<span>${esc(i.customerAddress)}</span>` : ""}</div><div class="right"><small>INVOICE DATE</small><strong>${esc(i.date)}</strong><span>Currency: PKR</span></div></div><table class="paper-table"><thead><tr><th>#</th><th>DESCRIPTION</th><th>QTY</th><th>UNIT</th><th>RATE</th><th>AMOUNT</th></tr></thead><tbody>${i.items.map((x, n) => `<tr><td>${n + 1}</td><td>${esc(x.description)}</td><td>${esc(x.qty)}</td><td>${esc(x.unit)}</td><td>${Number(x.rate).toLocaleString("en-PK")}</td><td>${Number(x.qty * x.rate).toLocaleString("en-PK", { maximumFractionDigits: 2 })}</td></tr>`).join("")}</tbody></table><div class="paper-totals"><div><span>Subtotal</span><b>${money(i.subtotal)}</b></div>${i.discount ? `<div><span>Discount</span><b>− ${money(i.discount)}</b></div>` : ""}<div class="paper-grand"><span>GRAND TOTAL</span><b>${money(i.total)}</b></div></div>${i.notes ? `<div class="paper-notes"><small>NOTES</small><p>${esc(i.notes)}</p></div>` : ""}<div class="paper-sign"><div><span>Authorized Signature / Stamp</span>${i.stamp !== false ? '<img src="/assets/stamp.png" alt="Authorized business stamp">' : ""}</div></div><footer class="paper-footer"><b>UMAIR TRADERS</b><span>27-E, Gulberg Main Market, Lahore &nbsp; | &nbsp; +92-309-9444429</span></footer></article>`;
}
function view() {
  const i = state.invoices.find((x) => x.id === state.viewId);
  if (!i) {
    navigate("invoices");
    return;
  }
  $("#content").innerHTML =
    `<div class="heading"><div><p class="eyebrow">INVOICE DETAILS</p><h1>${esc(i.number)}</h1><p>Review, print or download this invoice.</p></div><button class="secondary" id="back">← All invoices</button></div><div class="invoice-actions"><button class="primary" id="download">↓ Download PDF</button><button class="secondary" id="print">Print</button><button class="secondary" id="edit">Edit</button><button class="secondary" id="duplicate">Duplicate</button><button class="danger" id="delete">Delete</button></div><div class="paper-wrap">${invoiceHTML(i)}</div>`;
  $("#back").onclick = () => navigate("invoices");
  $("#print").onclick = () => window.print();
  $("#edit").onclick = () => {
    state.editId = i.id;
    state.page = "new";
    shell();
  };
  $("#duplicate").onclick = () => {
    state.editId = null;
    state.page = "new";
    shell();
    state.items = i.items.map((x) => ({ ...x }));
    drawRows();
    $("#customerName").value = i.customerName || "";
    $("#customerPhone").value = i.customerPhone || "";
    $("#customerAddress").value = i.customerAddress || "";
    $("#discount").value = i.discount || 0;
    $("#notes").value = i.notes || "";
    calc();
  };
  $("#delete").onclick = async () => {
    if (!confirm("Permanently delete this invoice?")) return;
    try {
      await deleteDoc(doc(db, "invoices", i.id));
      await load();
      navigate("invoices");
      notice("Invoice deleted");
    } catch (e) {
      notice(e.message, true);
    }
  };
  $("#download").onclick = async () => {
    const btn = $("#download");
    btn.disabled = true;
    btn.textContent = "Generating PDF...";
    try {
      const node = $("#paper");
      await Promise.all(
        [...node.querySelectorAll("img")].map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
              }),
        ),
      );
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const pdf = new jsPDF("p", "mm", "a4");
      const w = 210,
        h = (canvas.height * w) / canvas.width;
      const img = canvas.toDataURL("image/jpeg", 0.95);
      if (h <= 297) {
        pdf.addImage(img, "JPEG", 0, 0, w, h);
      } else {
        let remaining = h,
          pos = 0;
        while (remaining > 0) {
          pdf.addImage(img, "JPEG", 0, pos, w, h);
          remaining -= 297;
          pos -= 297;
          if (remaining > 0) pdf.addPage();
        }
      }
      pdf.save(`${i.number}.pdf`);
    } catch (err) {
      notice("PDF generation failed: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "↓ Download PDF";
    }
  };
}
if (!configured) login();
else
  
onAuthStateChanged(auth, async (user) => {
  console.log("AUTH STATE CHANGED:", user?.uid || "No user");

  if (!user) {
    state.user = null;
    login();
    return;
  }

  try {
    console.log("STEP 1: Checking Firestore authorization");

    const access = await getDoc(
      doc(db, "authorizedUsers", user.uid)
    );

    console.log("STEP 2: Authorization document exists:", access.exists());

    if (!access.exists() || access.data()?.active !== true) {
      console.error("User not authorized or inactive");

      await signOut(auth);
      state.user = null;
      login();

      notice(
        "Account is not authorized or inactive. Check Firestore authorizedUsers.",
        true
      );
      return;
    }

    console.log("STEP 3: User authorized", access.data());

    state.user = user;

    console.log("STEP 4: Loading CRM data");

    await load();

    console.log("STEP 5: CRM data loaded");

    state.page = "dashboard";
    shell();

    console.log("STEP 6: Dashboard rendered");

  } catch (e) {
    console.error("CRM INITIALIZATION ERROR:", e);
    console.error("ERROR CODE:", e.code);
    console.error("ERROR MESSAGE:", e.message);

    login();

    notice(
      "Unable to load CRM: " + (e.code || "") + " " + e.message,
      true
    );
  }
});
