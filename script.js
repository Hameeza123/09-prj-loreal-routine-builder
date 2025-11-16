/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineBtn = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const searchInput = document.getElementById("productSearch");

/* Config: set `window.WORKER_URL` in a `secrets.js` file to point to your Cloudflare Worker
   e.g. window.WORKER_URL = 'https://your-worker.example.workers.dev/'; */
const WORKER_URL = window.WORKER_URL || null;
// Default system prompt to ensure the Worker receives chat-style instructions
const DEFAULT_SYSTEM_PROMPT = `You are a friendly L'Oréal product advisor. When asked to generate a routine, produce a clear step-by-step routine with a short rationale for each step and usage notes. When answering follow-up questions, use the provided routine and product context. Keep answers concise and professional.`;

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

// `fullProducts` stores the complete product list loaded from `products.json`.
// `displayedProducts` contains the currently visible (filtered) products.
let fullProducts = [];
let displayedProducts = [];
let selectedIds = new Set();
let conversation = []; // chat history (objects {role:'user'|'assistant', text:''})

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Persist selected ids to localStorage */
function saveSelected() {
  localStorage.setItem(
    "selectedProductIds",
    JSON.stringify(Array.from(selectedIds))
  );
}

function loadSelected() {
  const raw = localStorage.getItem("selectedProductIds");
  if (!raw) return;
  try {
    const arr = JSON.parse(raw);
    // Normalize stored ids to strings to avoid type mismatches with dataset ids
    selectedIds = new Set((arr || []).map((x) => String(x)));
  } catch (e) {
    selectedIds = new Set();
  }
}

function saveConversation() {
  localStorage.setItem("routineChatHistory", JSON.stringify(conversation));
}

function loadConversation() {
  const raw = localStorage.getItem("routineChatHistory");
  if (!raw) return;
  try {
    conversation = JSON.parse(raw);
  } catch (e) {
    conversation = [];
  }
}

/* Render products into grid with description toggle and selection state */
function displayProducts(products) {
  displayedProducts = products;
  productsContainer.innerHTML = products
    .map((product, idx) => {
      // Compute a stable id: prefer provided `product.id`, otherwise use its index
      // in the fullProducts array so the id is consistent across filters.
      const globalIndex = fullProducts.indexOf(product);
      const fallbackIndex = globalIndex >= 0 ? globalIndex : idx;
      const id = String(product.id || `prod-${fallbackIndex}`);
      const isSelected = selectedIds.has(String(id)) ? "selected" : "";
      return `
    <div class="product-card ${isSelected}" data-id="${id}">
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <h3>${product.name}</h3>
        <p class="brand">${product.brand}</p>
        <button class="desc-toggle" aria-expanded="false">Details</button>
        <div class="product-desc" hidden>${escapeHtml(
          product.description || "No description available."
        )}</div>
      </div>
    </div>
  `;
    })
    .join("");

  // Attach event listeners after elements are in DOM
  document.querySelectorAll(".product-card").forEach((card) => {
    const id = card.dataset.id;
    // Toggle selection when clicking card (except when clicking description toggle)
    card.addEventListener("click", (e) => {
      if (e.target.closest(".desc-toggle")) return; // let desc-toggle handle it
      toggleSelect(id, card);
    });

    const descToggle = card.querySelector(".desc-toggle");
    const desc = card.querySelector(".product-desc");
    descToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = descToggle.getAttribute("aria-expanded") === "true";
      descToggle.setAttribute("aria-expanded", String(!isOpen));
      desc.hidden = !desc.hidden;
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* Toggle selection state for a product */
function toggleSelect(id, cardEl) {
  const sid = String(id);
  if (selectedIds.has(sid)) {
    selectedIds.delete(sid);
    cardEl.classList.remove("selected");
  } else {
    selectedIds.add(sid);
    cardEl.classList.add("selected");
  }
  saveSelected();
  renderSelectedList();
}

/* Render Selected Products list (chips) */
function renderSelectedList() {
  const items = Array.from(selectedIds)
    .map((id) => {
      const product =
        fullProducts.find((p, idx) => {
          const pid = String(p.id || `prod-${idx}`);
          return pid === String(id);
        }) || null;
      const title = product ? `${product.name} — ${product.brand}` : id;
      return `
      <div class="selected-chip" data-id="${id}">
        <span>${escapeHtml(title)}</span>
        <button class="remove-chip" aria-label="Remove ${escapeHtml(
          title
        )}">&times;</button>
      </div>
    `;
    })
    .join("");

  selectedProductsList.innerHTML =
    items || `<div class="none">No products selected</div>`;

  // attach remove handlers
  selectedProductsList.querySelectorAll(".remove-chip").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const chip = btn.closest(".selected-chip");
      const id = chip.dataset.id;
      selectedIds.delete(id);
      saveSelected();
      // unselect card in grid if present
      const card = document.querySelector(`.product-card[data-id='${id}']`);
      if (card) card.classList.remove("selected");
      renderSelectedList();
    });
  });
}

/* Utility: retrieve product objects for selected ids */
function getSelectedProducts() {
  return Array.from(selectedIds)
    .map((id) => {
      return fullProducts.find((p, idx) => String(p.id || `prod-${idx}`) === String(id));
    })
    .filter(Boolean);
}

/* When category changes, filter and display */
categoryFilter.addEventListener("change", () => {
  applyFilters();
});

// Search input: filter as the user types
if (searchInput) {
  searchInput.addEventListener("input", () => {
    applyFilters();
  });
}

/**
 * Apply current category filter and search text to `fullProducts` and display results.
 * If `fullProducts` is not yet loaded, load it first.
 */
async function applyFilters() {
  if (!fullProducts || !fullProducts.length) {
    const products = await loadProducts();
    fullProducts = products;
  }

  const category = categoryFilter && categoryFilter.value ? categoryFilter.value : "";
  const q = searchInput && searchInput.value ? searchInput.value.trim().toLowerCase() : "";

  const filtered = fullProducts.filter((p) => {
    // Category filter (if selected)
    if (category && p.category !== category) return false;
    // Search filter (if provided) - match name, brand, description, category
    if (!q) return true;
    const hay = `${p.name} ${p.brand} ${p.description} ${p.category}`.toLowerCase();
    return hay.indexOf(q) !== -1;
  });

  if (filtered.length) {
    displayProducts(filtered);
    // re-apply selection highlights
    document.querySelectorAll(".product-card").forEach((card) => {
      const id = card.dataset.id;
      if (selectedIds.has(id)) card.classList.add("selected");
    });
  } else {
    // Show empty placeholder
    productsContainer.innerHTML = `<div class="placeholder-message">No products match your search.</div>`;
  }
  renderSelectedList();
}

/* Generate Routine button handler */
generateRoutineBtn.addEventListener("click", async () => {
  const products = getSelectedProducts();
  if (!products.length) {
    appendChatMessage(
      "assistant",
      "Please select at least one product before generating a routine."
    );
    return;
  }

  appendChatMessage(
    "user",
    `Generate routine for selected products: ${products
      .map((p) => p.name)
      .join(", ")}`
  );

  // Prepare payload for Worker
  // Build messages for the Chat API (helps workers that expect a messages array)
  const userContent = `Generate a personalized routine using the selected products:\n${products
    .map(
      (p) => `- ${p.name} (${p.brand}) — ${p.category || "N/A"}: ${p.description || ""}`
    )
    .join("\n")}`;

  const payload = {
    products,
    messages: [
      { role: "system", content: DEFAULT_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  };

  appendChatMessage("assistant", "Generating routine…");

  try {
    let text = null;
    if (WORKER_URL) {
      const resp = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // Log payload for debugging (useful during development). Remove for production.
      console.debug("[Routine] payload ->", payload);
      const status = resp.status;
      const data = await resp.json().catch(() => null);
      console.debug("[Routine] worker status", status, "response:", data);

      if (!resp.ok) {
        // If the worker returned an error shape, show it in chat for debugging
        const errText = (data && data.error) ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)) : `Worker error: status ${status}`;
        appendChatMessage('assistant', `Error from worker: ${errText}`);
        return;
      }

      // Extract assistant text from common response shapes (Worker may return {answer},
      // or the full OpenAI response with `choices[0].message.content`).
      text = extractAssistantText(data);
    } else {
      // Local fallback: simple routine generator
      text = localRoutineGenerator(products);
    }

    // Replace last assistant 'Generating routine…' with actual routine
    // remove last assistant message if it was the placeholder
    if (
      conversation.length &&
      conversation[conversation.length - 1].text === "Generating routine…"
    ) {
      conversation.pop();
    }
    appendChatMessage("assistant", text);
    saveConversation();
  } catch (err) {
    appendChatMessage(
      "assistant",
      "Sorry — there was an error generating your routine."
    );
    console.error(err);
  }
});

/* Chat form: follow-ups about the generated routine */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;
  appendChatMessage("user", text);
  userInput.value = "";

  // Build a payload containing conversation + selected products
  const selected = getSelectedProducts();
  // Convert existing conversation into messages if needed, then append question and product summary
  const convMessages = (conversation || []).map((m) => ({ role: m.role, content: m.text }));
  const productSummary = selected
    .map((p) => `- ${p.name} (${p.brand}) — ${p.category || "N/A"}`)
    .join("\n") || "No selected products.";

  const payload = {
    conversation,
    products: selected,
    question: text,
    messages: [
      { role: "system", content: DEFAULT_SYSTEM_PROMPT },
      ...convMessages,
      { role: "user", content: `Products in context:\n${productSummary}\n\nQuestion: ${text}` },
    ],
  };

  appendChatMessage("assistant", "Thinking…");

  try {
    let reply = null;
    if (WORKER_URL) {
      const resp = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      console.debug("[Chat] payload ->", payload);
      const status = resp.status;
      const data = await resp.json().catch(() => null);
      console.debug("[Chat] worker status", status, "response:", data);
      if (!resp.ok) {
        const errText = (data && data.error) ? (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)) : `Worker error: status ${status}`;
        appendChatMessage('assistant', `Error from worker: ${errText}`);
        return;
      }
      reply = extractAssistantText(data);
    } else {
      // Local fallback: simple echo with context
      reply = `About your question: "${text}" — I can help with general advice about the selected products.`;
    }

    if (
      conversation.length &&
      conversation[conversation.length - 1].text === "Thinking…"
    )
      conversation.pop();
    appendChatMessage("assistant", reply);
    saveConversation();
  } catch (err) {
    appendChatMessage(
      "assistant",
      "Sorry — error responding to your question."
    );
    console.error(err);
  }
});

/* Append chat messages to window and keep conversation memory */
function appendChatMessage(role, text) {
  conversation.push({ role, text });
  renderChatWindow();
}

function renderChatWindow() {
  chatWindow.innerHTML = conversation
    .map(
      (m) =>
        `<div class="chat-line ${m.role}"><strong>${
          m.role === "user" ? "You" : "Advisor"
        }:</strong> ${escapeHtml(m.text)}</div>`
    )
    .join("");
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Helper: extract assistant text from Worker/OpenAI response shapes */
function extractAssistantText(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (data.answer && typeof data.answer === "string") return data.answer;
  if (data.result && typeof data.result === "string") return data.result;
  // OpenAI chat completion shape
  if (data.choices && Array.isArray(data.choices) && data.choices.length) {
    const choice = data.choices[0];
    if (choice.message && choice.message.content) return choice.message.content;
    if (choice.text) return choice.text;
  }
  // Older style top-level message
  if (data.message && data.message.content) return data.message.content;
  // Fallback: try to stringify smaller subset (avoid dumping entire object)
  try {
    return JSON.stringify(data).slice(0, 2000);
  } catch (e) {
    return String(data);
  }
}

/* Simple local routine generator (fallback when no Worker configured) */
function localRoutineGenerator(products) {
  const lines = [];
  lines.push("Personalized Routine (local preview):");
  const grouped = products.reduce((acc, p) => {
    const cat = p.category || "misc";
    acc[cat] = acc[cat] || [];
    acc[cat].push(p.name);
    return acc;
  }, {});

  Object.keys(grouped).forEach((cat) => {
    lines.push(`\n${capitalize(cat)}:`);
    grouped[cat].forEach((name, i) => {
      lines.push(`  ${i + 1}. ${name}`);
    });
  });

  lines.push(
    "\nTip: For best results, connect a Cloudflare Worker endpoint to call OpenAI."
  );
  return lines.join("\n");
}

function capitalize(s) {
  return s && s[0].toUpperCase() + s.slice(1);
}

/* On load: restore selections & conversation */
loadSelected();
loadConversation();
if (conversation.length) renderChatWindow();

// Simple helper: on initial load, populate products so the selected list can show labels if user reloads
loadProducts().then((products) => {
  fullProducts = products;
  renderSelectedList();
});

/* Clear all selections button */
const clearBtn = document.getElementById("clearSelection");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    selectedIds.clear();
    saveSelected();
    renderSelectedList();
    document
      .querySelectorAll(".product-card.selected")
      .forEach((c) => c.classList.remove("selected"));
  });
}
