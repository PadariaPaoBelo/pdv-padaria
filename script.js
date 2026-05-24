const LS_DAILY_BACKUPS = 'novo_pdv_daily_backups_v1';
const LS_PRODUCTS = 'novo_pdv_products_v1';
const LS_SALES = 'novo_pdv_sales_v1';
const LS_CASH = 'novo_pdv_cash_v1';
const LS_SESSION = 'novo_pdv_session_v1';
const LS_USERS = 'novo_pdv_users_v1';
const ADMIN_ACTION_PASSWORD = '9138';

// ==========================================
// CONFIGURAÇÃO SUPERTEF / STONE
// ==========================================
// ATENÇÃO: em GitHub público esse token fica exposto.
// Para teste funciona, mas depois o ideal é trocar para backend seguro.
const SUPERTEF_TOKEN = '3f3eb892170f11f0c5a9b9b73c3c2c3bbe207e9f1423444fd5c0eb2e5f70404e';
const SUPERTEF_POS_CHAVE = '2272';
const SUPERTEF_ENDPOINT = 'https://api.supertef.com.br/api/pagamentos/intencao';


const $ = (id) => document.getElementById(id);

let products = load(LS_PRODUCTS, []);
let sales = load(LS_SALES, []);
let cash = load(LS_CASH, getDefaultCashState());
let session = load(LS_SESSION, null);
let users = load(LS_USERS, getDefaultUsers());
let cart = [];
let editingProductId = null;
let searchDebounce = null;
let dailyBackups = load(LS_DAILY_BACKUPS, []);

function getDefaultUsers() {
  return [
    { id: 'u_admin', username: 'admin', password: '1234', role: 'admin', name: 'Administrador' },
    { id: 'u_heider', username: 'heider', password: '1234', role: 'operador', name: 'Heider' },
    { id: 'u_denilson', username: 'denilson', password: '1234', role: 'operador', name: 'Denilson' }
  ];
}

function ensureDefaultUsers() {
  const defaults = getDefaultUsers();

  if (!Array.isArray(users) || !users.length) {
    users = defaults;
    persistAll();
    return;
  }

  defaults.forEach((defaultUser) => {
    const exists = users.some((user) => user.username === defaultUser.username);
    if (!exists) {
      users.push(defaultUser);
    }
  });

  persistAll();
}

function normalizeProduct(product) {
  return {
    ...product,
    unitType: product?.unitType === 'peso' ? 'peso' : 'unidade',
    stock: Number(product?.stock || 0),
    sold: Number(product?.sold || 0),
    price: Number(product?.price || 0)
  };
}

function normalizeProductsList() {
  if (!Array.isArray(products)) {
    products = [];
    return;
  }

  products = products.map(normalizeProduct);
}

function getDefaultCashState() {
  return {
    isOpen: false,
    openedAt: null,
    openingValue: 0,
    operatorId: null,
    operatorName: null,
    closeValue: 0,
    closedAt: null
  };
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function persistAll() {
  normalizeProductsList();
  save(LS_PRODUCTS, products);
  save(LS_SALES, sales);
  save(LS_CASH, cash);
  save(LS_SESSION, session);
  save(LS_USERS, users);
  save(LS_DAILY_BACKUPS, dailyBackups);
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function formatQty(value, unitType = 'unidade') {
  const numeric = Number(value || 0);
  if (unitType === 'peso') {
    return `${numeric.toLocaleString('pt-BR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    })} kg`;
  }
  return `${Math.round(numeric)}x`;
}

function parseBRL(value) {
  if (typeof value === 'number') return value;
  const normalized = String(value || '0')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return Number(normalized) || 0;
}

function parseDecimalInput(value) {
  if (typeof value === 'number') return value;

  let raw = String(value || '').trim().replace(/\s/g, '');
  if (!raw) return 0;

  raw = raw.replace(/kg/gi, '').replace(/g/gi, '').trim();
  if (!raw) return 0;

  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');

  if (hasComma && hasDot) {
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    const decimalSeparator = lastComma > lastDot ? ',' : '.';

    if (decimalSeparator === ',') {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else {
      raw = raw.replace(/,/g, '');
    }
  } else if (hasComma) {
    raw = raw.replace(',', '.');
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoneyInput(input) {
  if (!input) return;

  let digits = String(input.value || '').replace(/\D/g, '');

  if (!digits) {
    input.value = '0,00';
    return;
  }

  while (digits.length < 3) {
    digits = '0' + digits;
  }

  const integerPart = digits.slice(0, -2);
  const decimalPart = digits.slice(-2);
  const integerNumber = Number(integerPart) || 0;

  input.value = integerNumber.toLocaleString('pt-BR') + ',' + decimalPart;
}

function bindMoneyMask(inputId, onChange) {
  const input = $(inputId);
  if (!input || input.dataset.maskBound === '1') return;
  input.addEventListener('input', () => {
    formatMoneyInput(input);
    if (typeof onChange === 'function') onChange();
  });
  input.dataset.maskBound = '1';
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getCurrentUser() {
  if (!session?.userId) return null;
  return users.find((user) => user.id === session.userId) || null;
}

function isAdmin() {
  return getCurrentUser()?.role === 'admin';
}

function isOperator() {
  return getCurrentUser()?.role === 'operador';
}

function canAccessTab(tabName) {
  const user = getCurrentUser();
  if (!user) return false;

  if (user.role === 'admin') return true;
  if (user.role === 'operador') return ['venda', 'caixa'].includes(tabName);

  return false;
}

function canSell() {
  return !!getCurrentUser() && cash.isOpen;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function askAdminPassword(message) {
  if (!isAdmin()) {
    alert('Só o administrador pode executar esta ação.');
    return false;
  }

  const password = prompt(message || 'Digite a senha do administrador:');
  if (password === null) return false;

  if (String(password).trim() !== ADMIN_ACTION_PASSWORD) {
    alert('Senha incorreta. Operação cancelada.');
    return false;
  }

  return true;
}

function seedProducts() {
  if (products.length) {
    alert('A base já foi carregada.');
    return;
  }

  products = [
    { id: uid(), code: '1001', name: 'Pão francês', price: 1.00, stock: 120, category: 'Padaria', sold: 0, unitType: 'unidade' },
    { id: uid(), code: '1002', name: 'Café com leite', price: 4.50, stock: 60, category: 'Balcão', sold: 0, unitType: 'unidade' },
    { id: uid(), code: '1003', name: 'Pão de queijo', price: 3.50, stock: 50, category: 'Padaria', sold: 0, unitType: 'unidade' },
    { id: uid(), code: '1004', name: 'Coxinha', price: 7.00, stock: 40, category: 'Salgados', sold: 0, unitType: 'unidade' },
    { id: uid(), code: '1005', name: 'Refrigerante lata', price: 6.00, stock: 36, category: 'Bebidas', sold: 0, unitType: 'unidade' },
    { id: uid(), code: '1006', name: 'Água mineral', price: 3.00, stock: 48, category: 'Bebidas', sold: 0, unitType: 'unidade' },
    { id: uid(), code: '1007', name: 'Bolo de pote', price: 8.50, stock: 20, category: 'Doces', sold: 0, unitType: 'unidade' },
    { id: uid(), code: '1008', name: 'Misto quente', price: 9.00, stock: 25, category: 'Balcão', sold: 0, unitType: 'unidade' }
  ].map(normalizeProduct);

  persistAll();
  renderAll();
  alert('Base inicial carregada.');
}

function login() {
  const username = $('loginUser')?.value.trim();
  const password = $('loginPass')?.value.trim();

  if (!username || !password) {
    alert('Digite usuário e senha.');
    return;
  }

  const found = users.find(
    (user) => user.username === username && user.password === password
  );

  if (!found) {
    alert('Usuário ou senha inválidos.');
    return;
  }

  session = {
    userId: found.id,
    loginAt: new Date().toISOString()
  };

  persistAll();
  updateAuthUI();
  renderAll();
}

function logout() {
  if (cash.isOpen) {
    alert('Feche o caixa antes de sair.');
    return;
  }

  session = null;
  cart = [];
  persistAll();
  updateAuthUI();
}

function updateAuthUI() {
  const loginScreen = $('loginScreen');
  const appScreen = $('appScreen');
  const currentUser = getCurrentUser();

  if (currentUser) {
    loginScreen?.classList.remove('active');
    appScreen?.classList.add('active');

    if ($('userBadge')) {
      $('userBadge').textContent = `${currentUser.name} • ${currentUser.role}`;
    }

    applyRolePermissions();
  } else {
    appScreen?.classList.remove('active');
    loginScreen?.classList.add('active');

    if ($('userBadge')) $('userBadge').textContent = 'Não logado';
    if ($('loginPass')) $('loginPass').value = '';
  }
}

function switchTab(tabName) {
  if (!canAccessTab(tabName)) {
    alert('Seu usuário não tem permissão para acessar esta área.');
    return;
  }

  document.querySelectorAll('.tab-section').forEach((section) => {
    section.classList.remove('active');
  });

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.remove('active');
  });

  const map = {
    venda: 'tabVenda',
    produtos: 'tabProdutos',
    caixa: 'tabCaixa',
    relatorios: 'tabRelatorios'
  };

  const sectionId = map[tabName];
  if ($(sectionId)) $(sectionId).classList.add('active');

  document.querySelectorAll(`.nav-btn[data-tab="${tabName}"]`).forEach((btn) => {
    btn.classList.add('active');
  });
}

function getQuickQty(unitType = 'unidade') {
  const input = $('quickQty');
  const rawValue = String(input?.value || '').trim();

  if (unitType === 'peso') {
    const normalized = rawValue
      .toLowerCase()
      .replace(/kg/g, '')
      .replace(/g/g, '')
      .trim();

    let value = parseDecimalInput(normalized);

    if (!value || value <= 0) return null;

    if (value > 0 && value >= 1) {
      return value;
    }

    return value;
  }

  const parsed = parseInt(rawValue, 10);
  if (!parsed || parsed <= 0) return 1;
  return parsed;
}

function requestWeightForProduct(product) {
  const answer = prompt(`Digite o peso em kg para "${product.name}".
Exemplo: 0,100 para 100 gramas.`);
  if (answer === null) return null;

  return parseWeightInput(answer);
}

function parseWeightInput(rawValue) {
  const raw = String(rawValue || '').toLowerCase().trim();
  if (!raw) return null;

  const hasKg = raw.includes('kg');
  const hasG = raw.includes('g') && !hasKg;

  const cleaned = raw
    .replace(/kg/g, '')
    .replace(/g/g, '')
    .trim();

  let weight = parseDecimalInput(cleaned);

  if (!weight || weight <= 0) return null;

  if (hasG) {
    weight = weight / 1000;
  }

  return Number(weight.toFixed(3));
}

function quickQtyLooksLikeWeight(rawValue) {
  const raw = String(rawValue || '').toLowerCase().trim();
  if (!raw) return false;

  return raw.includes(',') || raw.includes('.') || raw.includes('g');
}

function resolveSaleQty(product) {
  const inputValue = String($('quickQty')?.value || '').trim();
  const typedWeight = quickQtyLooksLikeWeight(inputValue);

  if (product.unitType === 'peso' || typedWeight) {
    if (inputValue) {
      const weight = parseWeightInput(inputValue);

      if (!weight || weight <= 0) {
        alert('Peso inválido. Use 0,100 para 100g ou 100g.');
        return null;
      }

      return {
        qty: weight,
        unitType: 'peso'
      };
    }

    const promptedWeight = requestWeightForProduct(product);
    if (!promptedWeight || promptedWeight <= 0) return null;

    return {
      qty: promptedWeight,
      unitType: 'peso'
    };
  }

  return {
    qty: getQuickQty('unidade'),
    unitType: 'unidade'
  };
}

function findProductByTerm(term) {
  const q = normalizeText(term);
  if (!q) return null;

  let exact = products.find((product) => normalizeText(product.code) === q);
  if (exact) return exact;

  exact = products.find((product) => normalizeText(product.name) === q);
  if (exact) return exact;

  return products.find((product) => {
    return normalizeText(product.name).includes(q) ||
      normalizeText(product.code).includes(q) ||
      normalizeText(product.category).includes(q);
  }) || null;
}

function getFilteredProducts(limit = 12) {
  const term = $('searchProduct')?.value || '';
  const q = normalizeText(term);

  let filtered = [...products];
  if (q) {
    filtered = filtered.filter((product) => {
      return normalizeText(product.name).includes(q) ||
        normalizeText(product.code).includes(q) ||
        normalizeText(product.category).includes(q);
    });
  }

  filtered.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return filtered.slice(0, limit);
}

function addToCart(productId) {
  if (!cash.isOpen) {
    alert('Abra o caixa antes de vender.');
    return;
  }

  const product = products.find((item) => item.id === productId);
  if (!product) return;

  const resolvedSale = resolveSaleQty(product);
  if (!resolvedSale || resolvedSale.qty === null) return;

  const qty = Number(resolvedSale.qty);
  const saleUnitType = resolvedSale.unitType || product.unitType || 'unidade';

  const currentInCart = cart.find((item) => item.id === productId && item.unitType === saleUnitType);
  const totalDesired = Number((currentInCart?.qty || 0) + qty);

  if (product.stock <= 0) {
    alert('Produto sem estoque.');
    return;
  }

  if (totalDesired > product.stock + 0.000001) {
    alert('Quantidade maior que o estoque disponível.');
    return;
  }

  if (currentInCart) {
    currentInCart.qty = Number(currentInCart.qty) + qty;
    currentInCart.total = Number(currentInCart.qty) * Number(currentInCart.price);
  } else {
    cart.push({
      id: product.id,
      code: product.code,
      name: product.name,
      price: Number(product.price),
      qty,
      unitType: saleUnitType,
      total: Number(product.price) * qty
    });
  }

  if ($('quickQty')) $('quickQty').value = '';
  if ($('searchProduct')) $('searchProduct').value = '';

  renderSaleArea();
  focusSearchField();
}

function removeFromCart(productId) {
  cart = cart.filter((item) => item.id !== productId);
  renderSaleArea();
}

function clearCart() {
  cart = [];
  if ($('receivedValue')) $('receivedValue').value = '';
  if ($('quickQty')) $('quickQty').value = '';
  renderSaleArea();
}

function getCartTotals() {
  const items = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const total = cart.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.price || 0)), 0);
  const received = parseBRL($('receivedValue')?.value || 0);
  const change = Math.max(received - total, 0);
  return { items, total, received, change };
}

function renderCart() {
  const cartList = $('cartList');
  if (!cartList) return;

  if (!cart.length) {
    cartList.innerHTML = '<div class="empty">Carrinho vazio</div>';
    return;
  }

  cartList.innerHTML = cart.map((item) => `
    <div class="cart-row">
      <span class="qty">${formatQty(item.qty, item.unitType)}</span>
      <span class="name">${escapeHtml(item.name)}</span>
      <span class="price">${money(Number(item.qty) * Number(item.price))}</span>
      <button class="remove" type="button" onclick="removeFromCart('${item.id}')">×</button>
    </div>
  `).join('');
}

function renderQuickProducts() {
  const container = $('quickProducts');
  if (!container) return;

  const filtered = getFilteredProducts();

  if (!filtered.length) {
    container.innerHTML = '<div class="empty">Nenhum produto encontrado</div>';
    return;
  }

  container.innerHTML = filtered.map((product) => `
    <button class="quick-product-btn" type="button" onclick="addToCart('${product.id}')">
      <strong>${escapeHtml(product.name)}</strong>
      <small>Cód.: ${escapeHtml(product.code)} • Tipo: ${product.unitType === 'peso' ? 'Peso' : 'Unidade'} • Estoque: ${product.unitType === 'peso' ? formatQty(product.stock, 'peso') : product.stock} • ${product.unitType === 'peso' ? `${money(product.price)}/kg` : money(product.price)}</small>
    </button>
  `).join('');
}

function renderSaleSummary() {
  const { items, total, change } = getCartTotals();

  if ($('saleItems')) $('saleItems').textContent = Number.isInteger(items) ? items : items.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  if ($('saleTotal')) $('saleTotal').textContent = money(total);
  if ($('saleChange')) $('saleChange').textContent = money(change);
  if ($('saleItemsTop')) $('saleItemsTop').textContent = Number.isInteger(items) ? items : items.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  if ($('saleTotalTop')) $('saleTotalTop').textContent = money(total);
}

function renderSaleArea() {
  renderCart();
  renderQuickProducts();
  renderSaleSummary();
}


function getSuperTefTransactionType(paymentMethod) {
  const method = normalizeText(paymentMethod);

  if (method.includes('pix')) return 'pix';
  if (method.includes('debito')) return 'debito';
  if (method.includes('credito')) return 'credito';
  if (method.includes('voucher')) return 'voucher';

  return null;
}

async function enviarPagamentoSuperTef(valor, paymentMethod) {
  const transactionType = getSuperTefTransactionType(paymentMethod);

  if (!transactionType) {
    return {
      success: false,
      message: 'Forma de pagamento não suportada pelo SuperTEF.'
    };
  }

  if (!SUPERTEF_TOKEN || SUPERTEF_TOKEN === 'COLE_SEU_TOKEN_AQUI') {
    alert('Cole o TOKEN do SuperTEF dentro do script.js antes de usar a integração.');
    return {
      success: false,
      message: 'Token SuperTEF não configurado.'
    };
  }

  const payload = {
    pos_chave: SUPERTEF_POS_CHAVE,
    transaction_type: transactionType,
    valor: Number(Number(valor || 0).toFixed(2)),
    installment_type: 'none',
    installment_count: 1
  };

  try {
    const response = await fetch(SUPERTEF_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPERTEF_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    let data = null;

    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }

    if (!response.ok) {
      const apiMessage = data?.message || data?.error || data?.erro || `Erro HTTP ${response.status}`;
      return {
        success: false,
        message: apiMessage,
        data
      };
    }

    return {
      success: true,
      data
    };
  } catch (error) {
    return {
      success: false,
      message: error?.message || 'Falha ao conectar com o SuperTEF.'
    };
  }
}

async function enviarCobrancaStoneAntesDeSalvar(total, paymentMethod) {
  const transactionType = getSuperTefTransactionType(paymentMethod);

  if (!transactionType) return true;

  const label = {
    pix: 'PIX',
    credito: 'Crédito',
    debito: 'Débito',
    voucher: 'Voucher'
  }[transactionType] || paymentMethod;

  const result = await enviarPagamentoSuperTef(total, paymentMethod);

  if (!result.success) {
    alert(`Não consegui enviar para a Stone.\n\nErro: ${result.message}`);
    return false;
  }

  return confirm(`Cobrança enviada para a Stone.\n\nTipo: ${label}\nValor: ${money(total)}\n\nConclua na maquininha e clique em OK somente se o pagamento foi APROVADO.`);
}

async function finishSale() {
  if (!cash.isOpen) {
    alert('Abra o caixa antes de finalizar venda.');
    return;
  }

  if (!cart.length) {
    alert('Carrinho vazio.');
    return;
  }

  const currentUser = getCurrentUser();
  const { total, received, change } = getCartTotals();
  const paymentMethod = $('paymentMethod')?.value || 'Dinheiro';

  if (paymentMethod === 'Dinheiro' && received < total) {
    alert('Valor recebido menor que o total.');
    return;
  }

  const stoneOk = await enviarCobrancaStoneAntesDeSalvar(total, paymentMethod);
  if (!stoneOk) {
    alert('Venda não finalizada.');
    return;
  }

  const sale = {
    id: uid(),
    createdAt: new Date().toISOString(),
    cashierId: currentUser?.id || null,
    cashierName: currentUser?.name || 'Operador',
    paymentMethod,
    items: cart.map((item) => ({ ...item })),
    total,
    received: paymentMethod === 'Dinheiro' ? received : total,
    change: paymentMethod === 'Dinheiro' ? change : 0
  };

  for (const item of cart) {
    const product = products.find((prod) => prod.id === item.id);
    if (!product) continue;

    if (Number(product.stock) + 0.000001 < Number(item.qty)) {
      alert(`Estoque insuficiente para ${product.name}.`);
      return;
    }
  }

  cart.forEach((item) => {
    const product = products.find((prod) => prod.id === item.id);
    if (!product) return;
    product.stock = Number(product.stock) - Number(item.qty);
    product.sold = Number(product.sold || 0) + Number(item.qty);
  });

  sales.unshift(sale);
  createOrUpdateDailyBackup();
  clearCart();
  persistAll();
  renderAll();
  alert('Venda finalizada com sucesso.');
  renderExpectedCloseValue();
}

function getSelectedProductType() {
  const input = $('prodType');
  if (!input) return 'unidade';
  return input.value === 'peso' ? 'peso' : 'unidade';
}

function saveProduct() {
  if (!isAdmin()) {
    alert('Só o administrador pode cadastrar ou editar produtos.');
    return;
  }

  const name = $('prodName')?.value.trim();
  const code = $('prodCode')?.value.trim();
  const price = parseBRL($('prodPrice')?.value || 0);
  const stock = parseDecimalInput($('prodStock')?.value || 0);
  const category = $('prodCategory')?.value.trim() || 'Geral';
  const unitType = getSelectedProductType();

  if (!name) return alert('Digite o nome do produto.');
  if (!code) return alert('Digite o código do produto.');
  if (price <= 0) return alert('Digite um preço válido.');
  if (stock < 0) return alert('Estoque inválido.');

  const duplicate = products.find((product) => product.code === code && product.id !== editingProductId);
  if (duplicate) return alert('Já existe produto com esse código.');

  if (editingProductId) {
    const product = products.find((item) => item.id === editingProductId);
    if (!product) return;
    product.name = name;
    product.code = code;
    product.price = price;
    product.stock = stock;
    product.category = category;
    product.unitType = unitType;
    editingProductId = null;
    if ($('saveProductBtn')) $('saveProductBtn').textContent = 'Salvar produto';
  } else {
    products.unshift(normalizeProduct({
      id: uid(),
      name,
      code,
      price,
      stock,
      category,
      sold: 0,
      unitType
    }));
  }

  clearProductForm();
  persistAll();
  renderProductsArea();
  renderReports();
}

function editProduct(productId) {
  if (!isAdmin()) {
    alert('Só o administrador pode editar produtos.');
    return;
  }

  const product = products.find((item) => item.id === productId);
  if (!product) return;

  $('prodName').value = product.name;
  $('prodCode').value = product.code;
  $('prodPrice').value = Number(product.price).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  $('prodStock').value = product.unitType === 'peso'
    ? Number(product.stock).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    : product.stock;
  $('prodCategory').value = product.category;
  if ($('prodType')) $('prodType').value = product.unitType || 'unidade';
  editingProductId = product.id;
  if ($('saveProductBtn')) $('saveProductBtn').textContent = 'Atualizar produto';
  switchTab('produtos');
}

function clearAllStock() {
  if (!isAdmin()) {
    alert('Só o administrador pode zerar o estoque.');
    return;
  }

  if (!products.length) {
    alert('Não há produtos cadastrados para zerar o estoque.');
    return;
  }

  if (cart.length > 0) {
    alert('Esvazie o carrinho antes de zerar o estoque.');
    return;
  }

  if (!askAdminPassword('Digite a senha para limpar o estoque:')) return;

  const confirmClear = confirm('Deseja zerar o estoque de todos os produtos? Essa ação define o estoque como 0 para todos os itens cadastrados.');
  if (!confirmClear) return;

  products = products.map((product) => ({
    ...product,
    stock: 0
  }));

  persistAll();
  renderProductsArea();
  renderReports();
  renderSaleArea();
  alert('Estoque zerado com sucesso.');
}

function deleteProduct(productId) {
  if (!isAdmin()) {
    alert('Só o administrador pode excluir produtos.');
    return;
  }

  const product = products.find((item) => item.id === productId);
  if (!product) return;

  const productInCart = cart.some((item) => item.id === productId);
  if (productInCart) {
    alert('Este produto está no carrinho atual. Remova do carrinho antes de excluir.');
    return;
  }

  const productHasSales = sales.some((sale) => {
    return Array.isArray(sale.items) && sale.items.some((item) => item.id === productId);
  });

  if (productHasSales) {
    alert('Este produto já possui vendas registradas e não pode ser excluído. Edite o cadastro ou zere o estoque.');
    return;
  }

  const confirmDelete = confirm(`Excluir o produto "${product.name}"?`);
  if (!confirmDelete) return;

  products = products.filter((item) => item.id !== productId);

  if (editingProductId === productId) {
    editingProductId = null;
    clearProductForm();
    if ($('saveProductBtn')) $('saveProductBtn').textContent = 'Salvar produto';
  }

  persistAll();
  renderProductsArea();
  renderReports();
  renderSaleArea();
  alert('Produto excluído com sucesso.');
}

function clearProductForm() {
  if ($('prodName')) $('prodName').value = '';
  if ($('prodCode')) $('prodCode').value = '';
  if ($('prodPrice')) $('prodPrice').value = '';
  if ($('prodStock')) $('prodStock').value = '';
  if ($('prodCategory')) $('prodCategory').value = '';
  if ($('prodType')) $('prodType').value = 'unidade';
}

function getProductFilterResult() {
  const search = normalizeText($('productFilter')?.value || '');
  const category = $('productCategoryFilter')?.value || '';

  return products.filter((product) => {
    const matchSearch = !search ||
      normalizeText(product.name).includes(search) ||
      normalizeText(product.code).includes(search) ||
      normalizeText(product.category).includes(search);

    const matchCategory = !category || product.category === category;
    return matchSearch && matchCategory;
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function renderCategoryFilter() {
  const select = $('productCategoryFilter');
  if (!select) return;

  const current = select.value;
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  select.innerHTML = '<option value="">Todas</option>' + categories.map((category) => {
    return `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`;
  }).join('');

  select.value = categories.includes(current) ? current : '';
}

function renderProductList() {
  const list = $('productList');
  if (!list) return;

  const filtered = getProductFilterResult();

  if (!filtered.length) {
    list.innerHTML = '<div class="empty">Nenhum produto encontrado</div>';
    return;
  }

  const admin = isAdmin();

  list.innerHTML = filtered.map((product) => `
    <div class="product-item">
      <div class="item-top">
        <div>
          <div class="item-title">${escapeHtml(product.name)}</div>
          <div class="item-meta">Cód.: ${escapeHtml(product.code)} • Categoria: ${escapeHtml(product.category)} • Tipo: ${product.unitType === 'peso' ? 'Peso' : 'Unidade'} • Estoque: ${product.unitType === 'peso' ? formatQty(product.stock, 'peso') : product.stock}</div>
        </div>
        <strong>${product.unitType === 'peso' ? `${money(product.price)}/kg` : money(product.price)}</strong>
      </div>
      ${admin ? `
        <div class="item-actions">
          <button class="btn btn-secondary" type="button" onclick="editProduct('${product.id}')">Editar</button>
          <button class="btn btn-danger" type="button" onclick="deleteProduct('${product.id}')">Excluir</button>
          <button class="btn btn-primary" type="button" onclick="addToCart('${product.id}')" style="grid-column: 1 / -1;">Adicionar</button>
        </div>
      ` : `
        <div class="item-actions">
          <button class="btn btn-primary" type="button" onclick="addToCart('${product.id}')">Adicionar</button>
        </div>
      `}
    </div>
  `).join('');
}

function renderProductsArea() {
  renderCategoryFilter();
  renderProductList();
}

function getSalesFromCurrentCashPeriod() {
  if (!cash?.isOpen || !cash?.openedAt) return [];

  const aberturaMs = new Date(cash.openedAt).getTime();

  return sales.filter((sale) => {
    const saleMs = new Date(sale.createdAt).getTime();
    return saleMs >= aberturaMs;
  });
}

function getVisibleSalesFromCurrentCashPeriod() {
  const currentUser = getCurrentUser();
  if (!currentUser) return [];

  const salesFromPeriod = getSalesFromCurrentCashPeriod();

  if (currentUser.role === 'admin') {
    return salesFromPeriod;
  }

  return salesFromPeriod.filter((sale) => sale.cashierId === currentUser.id);
}

function getExpectedCloseValue() {
  const salesFromPeriod = getSalesFromCurrentCashPeriod();

  const totalCashSales = salesFromPeriod.reduce((total, sale) => {
    const method = String(sale.paymentMethod || 'Dinheiro').toLowerCase();

    if (method.includes('dinheiro')) {
      return total + Number(sale.total || 0);
    }

    return total;
  }, 0);

  return Number(cash.openingValue || 0) + totalCashSales;
}

function openCash() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  if (cash.isOpen) {
    alert('O caixa já está aberto.');
    return;
  }

  if (!hasFilledValue('cashOpenValue')) {
    alert('Digite o valor de abertura do caixa, mesmo que seja 0,00.');
    $('cashOpenValue')?.focus();
    return;
  }

  const openingValue = parseBRL($('cashOpenValue')?.value || 0);

  cash = {
    isOpen: true,
    openedAt: new Date().toISOString(),
    openingValue,
    operatorId: currentUser.id,
    operatorName: currentUser.name,
    closeValue: 0,
    closedAt: null
  };

  cart = [];
  if ($('cashOpenValue')) $('cashOpenValue').value = '';
  if ($('cashCloseValue')) $('cashCloseValue').value = '';

  persistAll();
  createOrUpdateDailyBackup();
  renderCashArea();
  renderSalesHistory();
  alert(`Caixa aberto com sucesso. Valor de abertura registrado: ${money(openingValue)}.`);
  renderExpectedCloseValue();
}

function getTotalSalesCurrentCash() {
  const salesFromPeriod = getSalesFromCurrentCashPeriod();

  return salesFromPeriod.reduce((total, sale) => {
    return total + Number(sale.total || 0);
  }, 0);
}

function closeCash() {
  if (!cash.isOpen) {
    alert('O caixa já está fechado.');
    return;
  }

  const expectedValue = getExpectedCloseValue();

  if (!hasFilledValue('cashCloseValue')) {
    alert(`Informe o valor contado no fechamento. Neste momento, o caixa só pode fechar com ${money(expectedValue)}.`);
    $('cashCloseValue')?.focus();
    return;
  }

  const countedValue = parseBRL($('cashCloseValue')?.value || 0);
  const diff = Math.abs(countedValue - expectedValue);

  if (diff > 0.009) {
    alert(`Valor inválido para fechamento. O caixa só pode fechar com ${money(expectedValue)}.`);
    $('cashCloseValue')?.focus();
    return;
  }

  cash.closeValue = countedValue;
  cash.closedAt = new Date().toISOString();
  cash.isOpen = false;

  createOrUpdateDailyBackup();

  cash = getDefaultCashState();
  cart = [];

  if ($('cashOpenValue')) $('cashOpenValue').value = '';
  if ($('cashCloseValue')) $('cashCloseValue').value = '';

  persistAll();
  renderAll();
  alert(`Caixa fechado com sucesso no valor de ${money(countedValue)}.`);
}

function renderCashArea() {
  if ($('cashStatus')) $('cashStatus').textContent = cash.isOpen ? 'Aberto' : 'Fechado';
  if ($('cashOperator')) $('cashOperator').textContent = cash.operatorName || '-';

  if ($('cashOpeningValue')) {
    $('cashOpeningValue').textContent = isAdmin()
      ? money(cash.openingValue || 0)
      : 'Oculto';
  }

  if (!cash.isOpen) {
    if ($('cashOpenValue')) $('cashOpenValue').value = '';
    if ($('cashCloseValue')) $('cashCloseValue').value = '';
  }
}

function getVisibleSales() {
  const currentUser = getCurrentUser();
  if (!currentUser) return [];
  if (currentUser.role === 'admin') return sales;
  return sales.filter((sale) => sale.cashierId === currentUser.id);
}

function formatDateTime(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('pt-BR');
}

function renderSalesHistory() {
  const list = $('salesHistoryList');
  if (!list) return;

  const visibleSales = getVisibleSalesFromCurrentCashPeriod();

  if (!cash.isOpen) {
    list.innerHTML = '<div class="empty">Nenhuma venda no caixa atual</div>';
    return;
  }

  if (!visibleSales.length) {
    list.innerHTML = '<div class="empty">Nenhuma venda registrada neste caixa</div>';
    return;
  }

  list.innerHTML = visibleSales.slice(0, 20).map((sale, index) => {
    const d = new Date(sale.createdAt);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const numero = String(visibleSales.length - index).padStart(3, '0');

    return `
      <div class="history-item">
        <div class="item-title">Venda #${numero} • ${dia}/${mes} • ${h}:${m}</div>
        <div class="history-payment ${getPaymentClass(sale.paymentMethod)}">
          ${sale.paymentMethod || 'Dinheiro'}
        </div>
        <div class="item-meta">Operador: ${escapeHtml(sale.cashierName || 'Operador')}</div>
        <div class="history-total">Total: ${money(sale.total)}</div>
      </div>
    `;
  }).join('');
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createDailyBackupIfNeeded() {
  const todayKey = getDateKey();
  const alreadyExists = dailyBackups.some((backup) => backup.dateKey === todayKey);

  if (alreadyExists) return;
  createOrUpdateDailyBackup();
}

function createOrUpdateDailyBackup() {
  const todayKey = getDateKey();

  const todaySales = sales.filter((sale) => {
    return getDateKey(new Date(sale.createdAt)) === todayKey;
  });

  const totalRevenue = todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);

  const totalItems = todaySales.reduce((sum, sale) => {
    return sum + sale.items.reduce((sub, item) => sub + Number(item.qty || 0), 0);
  }, 0);

  const byPayment = {
    Dinheiro: 0,
    Pix: 0,
    Crédito: 0,
    Débito: 0,
    Voucher: 0,
    Cartão: 0
  };

  todaySales.forEach((sale) => {
    const method = sale.paymentMethod || 'Dinheiro';
    if (!byPayment[method]) byPayment[method] = 0;
    byPayment[method] += Number(sale.total || 0);
  });

  const soldProductsMap = {};

  todaySales.forEach((sale) => {
    sale.items.forEach((item) => {
      if (!soldProductsMap[item.name]) {
        soldProductsMap[item.name] = {
          name: item.name,
          qty: 0,
          total: 0,
          unitType: item.unitType === 'peso' ? 'peso' : 'unidade'
        };
      }

      soldProductsMap[item.name].qty += Number(item.qty || 0);
      soldProductsMap[item.name].total += Number(item.qty || 0) * Number(item.price || 0);
    });
  });

  const soldProducts = Object.values(soldProductsMap).sort((a, b) => b.qty - a.qty);

  const backupData = {
    dateKey: todayKey,
    createdAt: new Date().toISOString(),
    salesCount: todaySales.length,
    totalRevenue,
    totalItems,
    byPayment,
    cashSnapshot: {
      isOpen: cash.isOpen,
      openingValue: Number(cash.openingValue || 0),
      closeValue: Number(cash.closeValue || 0),
      operatorName: cash.operatorName || '-',
      openedAt: cash.openedAt || null,
      closedAt: cash.closedAt || null
    },
    soldProducts,
    sales: todaySales.map((sale) => ({ ...sale }))
  };

  const existingIndex = dailyBackups.findIndex((backup) => backup.dateKey === todayKey);

  if (existingIndex >= 0) {
    dailyBackups[existingIndex] = backupData;
  } else {
    dailyBackups.unshift(backupData);
  }

  persistAll();
}

function exportDailyBackups() {
  if (!dailyBackups.length) {
    alert('Nenhum backup diário registrado para exportar.');
    return;
  }

  if (!askAdminPassword('Digite a senha para exportar os backups:')) return;

  const payload = {
    exportedAt: new Date().toISOString(),
    totalBackups: dailyBackups.length,
    backups: dailyBackups
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = `backup_pdv_${getDateKey()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  alert('Backup exportado com sucesso.');
}

function clearDailyBackups() {
  if (!dailyBackups.length) {
    alert('Nenhum backup diário registrado para limpar.');
    return;
  }

  if (!askAdminPassword('Digite a senha para limpar os backups:')) return;

  const confirmClear = confirm('Deseja apagar todos os backups do histórico?');
  if (!confirmClear) return;

  dailyBackups = [];
  persistAll();
  renderReports();
  alert('Histórico de backups limpo com sucesso.');
}

function renderReports() {
  const totalProducts = products.length;
  const totalStock = products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const topProduct = [...products].sort((a, b) => Number(b.sold || 0) - Number(a.sold || 0))[0];

  if ($('repProducts')) $('repProducts').textContent = totalProducts;
  if ($('repStock')) $('repStock').textContent = totalStock.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
  if ($('repTop')) $('repTop').textContent = topProduct ? topProduct.name : '-';

  const reportBox = $('reportBox');
  if (!reportBox) return;

  const visibleSales = getVisibleSales();
  const today = new Date().toDateString();
  const todaySales = visibleSales.filter((sale) => new Date(sale.createdAt).toDateString() === today);
  const todayRevenue = todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);

  const backupActionsHtml = isAdmin() ? `
    <div class="report-item">
      <div class="item-title">Ações de backup</div>
      <div class="item-actions" style="margin-top:12px;">
        <button class="btn btn-primary" type="button" onclick="exportDailyBackups()">Exportar backup</button>
        <button class="btn btn-danger" type="button" onclick="clearDailyBackups()">Limpar backups</button>
      </div>
    </div>
  ` : '';

  const backupsHtml = dailyBackups.map((backup) => `
    <div class="report-item">
      <div class="item-title">Backup do dia ${backup.dateKey}</div>
      <div class="item-meta">Vendas: ${backup.salesCount}</div>
      <div class="item-meta">Itens vendidos: ${Number(backup.totalItems || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</div>
      <div class="item-meta">Faturamento: ${money(backup.totalRevenue)}</div>
      <div class="item-meta">Dinheiro: ${money(backup.byPayment.Dinheiro || 0)}</div>
      <div class="item-meta">Pix: ${money(backup.byPayment.Pix || 0)}</div>
      <div class="item-meta">Cartão: ${money(backup.byPayment.Cartão || 0)}</div>
      <div class="item-meta">Operador do caixa: ${escapeHtml(backup.cashSnapshot?.operatorName || '-')}</div>
    </div>
  `).join('');

  reportBox.innerHTML = `
    <div class="report-item">
      <div class="item-title">Resumo de hoje</div>
      <div class="item-meta">Vendas: ${todaySales.length}</div>
      <div class="item-meta">Faturamento: ${money(todayRevenue)}</div>
    </div>
    ${backupActionsHtml}
    ${backupsHtml || '<div class="empty">Nenhum backup diário registrado</div>'}
  `;
}

function renderAll() {
  renderSaleArea();
  renderCashArea();
  renderSalesHistory();

  if (isAdmin()) {
    renderProductsArea();
    renderReports();
  }

  applyRolePermissions();
  renderExpectedCloseValue();
}

function focusSearchField() {
  const input = $('searchProduct');
  if (!input) return;
  input.focus();
}

function handleSearchEnter(event) {
  if (event.key !== 'Enter') return;

  const product = findProductByTerm(event.target.value);
  if (!product) {
    alert('Produto não encontrado.');
    return;
  }

  addToCart(product.id);
}

function updateSalePanelSubtitle() {
  const el = $('salePanelSubtitle');
  if (!el) return;

  const now = new Date();

  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
  ];

  const dias = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

  const dia = now.getDate();
  const mes = meses[now.getMonth()];
  const semana = dias[now.getDay()];
  const hora = String(now.getHours()).padStart(2, '0');
  const minuto = String(now.getMinutes()).padStart(2, '0');

  el.textContent = `${dia} ${mes}, ${semana} ${hora}:${minuto}`;
}

function ensureAdminStockButton() {
  const actionRow = $('seedBtn')?.parentElement;
  if (!actionRow) return;

  let button = $('clearStockBtn');

  if (!button) {
    button = document.createElement('button');
    button.id = 'clearStockBtn';
    button.type = 'button';
    button.className = 'btn btn-danger';
    button.textContent = 'Limpar estoque';
    actionRow.appendChild(button);
    button.addEventListener('click', clearAllStock);
  }

  button.style.display = isAdmin() ? '' : 'none';
}

function bindEvents() {
  $('loginBtn')?.addEventListener('click', login);
  $('logoutBtn')?.addEventListener('click', logout);
  $('seedBtn')?.addEventListener('click', seedProducts);
  $('saveProductBtn')?.addEventListener('click', saveProduct);
  $('clearCartBtn')?.addEventListener('click', clearCart);
  $('finishSaleBtn')?.addEventListener('click', finishSale);
  $('openCashBtn')?.addEventListener('click', openCash);
  $('closeCashBtn')?.addEventListener('click', closeCash);
  $('prodCode')?.addEventListener('change', (event) => {
    fillProductFormByCode(event.target.value);
  });
  $('prodCode')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      fillProductFormByCode(event.target.value);
      $('prodName')?.focus();
    }
  });

  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  $('searchProduct')?.addEventListener('keydown', handleSearchEnter);
  $('searchProduct')?.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderQuickProducts, 120);
  });

  $('receivedValue')?.addEventListener('input', renderSaleSummary);
  $('productFilter')?.addEventListener('input', renderProductList);
  $('productCategoryFilter')?.addEventListener('change', renderProductList);

  $('loginPass')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') login();
  });

  bindMoneyMask('receivedValue', renderSaleSummary);
  bindMoneyMask('prodPrice');
  bindMoneyMask('cashOpenValue');
  bindMoneyMask('cashCloseValue');
}

window.removeFromCart = removeFromCart;
window.addToCart = addToCart;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.exportDailyBackups = exportDailyBackups;
window.clearDailyBackups = clearDailyBackups;
window.enviarPagamentoSuperTef = enviarPagamentoSuperTef;


function ensurePaymentOptions() {
  const select = $('paymentMethod');
  if (!select) return;

  const current = select.value || 'Dinheiro';

  select.innerHTML = `
    <option value="Dinheiro">Dinheiro</option>
    <option value="Pix">Stone PIX</option>
    <option value="Crédito">Stone Crédito</option>
    <option value="Débito">Stone Débito</option>
    <option value="Voucher">Stone Voucher</option>
  `;

  const allowedValues = ['Dinheiro', 'Pix', 'Crédito', 'Débito', 'Voucher'];
  select.value = allowedValues.includes(current) ? current : 'Dinheiro';
}

function init() {
  ensureDefaultUsers();
  normalizeProductsList();
  createDailyBackupIfNeeded();
  bindEvents();
  ensurePaymentOptions();
  ensureAdminStockButton();
  updateAuthUI();
  renderAll();
  switchTab('venda');
  updateSalePanelSubtitle();
  setInterval(updateSalePanelSubtitle, 60000);

  if (getCurrentUser()) {
    focusSearchField();
  }
}

document.addEventListener('DOMContentLoaded', init);

function getPaymentClass(method) {
  const m = (method || '').toLowerCase();

  if (m.includes('pix')) return 'pay-pix';
  if (m.includes('cart') || m.includes('credito') || m.includes('debito') || m.includes('voucher')) return 'pay-card';
  if (m.includes('dinheiro')) return 'pay-cash';

  return 'pay-default';
}

function applyRolePermissions() {
  const user = getCurrentUser();
  const navButtons = document.querySelectorAll('.nav-btn');

  navButtons.forEach((button) => {
    const tab = button.dataset.tab;
    const allowed = !!user && canAccessTab(tab);
    button.style.display = allowed ? '' : 'none';
  });

  if ($('tabProdutos')) $('tabProdutos').style.display = isAdmin() ? '' : 'none';
  if ($('tabRelatorios')) $('tabRelatorios').style.display = isAdmin() ? '' : 'none';

  if ($('seedBtn')) $('seedBtn').style.display = isAdmin() ? '' : 'none';
  if ($('saveProductBtn')) $('saveProductBtn').style.display = isAdmin() ? '' : 'none';
  if ($('clearStockBtn')) $('clearStockBtn').style.display = isAdmin() ? '' : 'none';

  ensureAdminStockButton();
}

function hasFilledValue(inputId) {
  const input = $(inputId);
  if (!input) return false;
  return String(input.value || '').trim() !== '';
}

function fillProductFormByCode(code) {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) return;

  const product = products.find((item) => String(item.code).trim() === cleanCode);

  if (!product) {
    editingProductId = null;
    if ($('prodName')) $('prodName').value = '';
    if ($('prodPrice')) $('prodPrice').value = '';
    if ($('prodStock')) $('prodStock').value = '';
    if ($('prodCategory')) $('prodCategory').value = '';
    if ($('prodType')) $('prodType').value = 'unidade';
    if ($('saveProductBtn')) $('saveProductBtn').textContent = 'Salvar produto';
    return;
  }

  editingProductId = product.id;

  if ($('prodName')) $('prodName').value = product.name || '';
  if ($('prodCode')) $('prodCode').value = product.code || '';
  if ($('prodPrice')) {
    $('prodPrice').value = Number(product.price || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
  if ($('prodStock')) {
    $('prodStock').value = product.unitType === 'peso'
      ? Number(product.stock || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
      : product.stock ?? 0;
  }
  if ($('prodCategory')) $('prodCategory').value = product.category || '';
  if ($('prodType')) $('prodType').value = product.unitType || 'unidade';
  if ($('saveProductBtn')) $('saveProductBtn').textContent = 'Atualizar produto';
}

function updateCashClosePreview() {
  const input = $('cashCloseValue');
  if (!input) return;

  if (!cash.isOpen) {
    input.value = '';
    return;
  }

  if (document.activeElement !== input) {
    input.value = '';
  }
}

function renderExpectedCloseValue() {
  const el = $('cashExpectedValue');
  if (!el) return;

  if (!cash.isOpen) {
    el.textContent = 'R$ 0,00';
    return;
  }

  el.textContent = money(getExpectedCloseValue());
}
