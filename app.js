import ExcelJS from "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/+esm";

const AUTH_TOKEN_KEY = "gestao-gastos-auth-token";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const state = {
  authToken: window.localStorage.getItem(AUTH_TOKEN_KEY) || "",
  authUser: null,
  userName: "",
  reportType: "Reembolso",
  projectName: "",
  projectId: "",
  isEditingSetup: false,
  projects: [],
  entries: [],
  storage: null,
};

const loginScreen = document.querySelector("#loginScreen");
const appContent = document.querySelector("#appContent");
const loginForm = document.querySelector("#loginForm");
const loginUsernameInput = document.querySelector("#loginUsername");
const loginPasswordInput = document.querySelector("#loginPassword");
const loginButton = document.querySelector("#loginButton");
const loginFeedback = document.querySelector("#loginFeedback");
const sessionUserLabel = document.querySelector("#sessionUserLabel");
const logoutButton = document.querySelector("#logoutButton");
const adminPanel = document.querySelector("#adminPanel");
const adminUserForm = document.querySelector("#adminUserForm");
const adminNewUsernameInput = document.querySelector("#adminNewUsername");
const adminNewPasswordInput = document.querySelector("#adminNewPassword");
const adminFeedback = document.querySelector("#adminFeedback");
const adminUsersList = document.querySelector("#adminUsersList");

const reportSetupForm = document.querySelector("#reportSetupForm");
const entryForm = document.querySelector("#entryForm");
const workspace = document.querySelector("#workspace");
const userNameInput = document.querySelector("#userName");
const projectNameInput = document.querySelector("#projectName");
const projectList = document.querySelector("#projectList");
const reportTypeInput = document.querySelector("#reportType");
const setupSubmitButton = document.querySelector("#setupSubmitButton");
const openProjectButton = document.querySelector("#openProjectButton");
const projectWorkspaceContent = document.querySelector("#projectWorkspaceContent");
const entryCategoryInput = document.querySelector("#entryCategory");
const receiptInput = document.querySelector("#entryReceipts");
const receiptPreview = document.querySelector("#receiptPreview");
const itemsList = document.querySelector("#itemsList");
const totalValue = document.querySelector("#totalValue");
const summaryUser = document.querySelector("#summaryUser");
const summaryProject = document.querySelector("#summaryProject");
const summaryType = document.querySelector("#summaryType");
const clearEntryButton = document.querySelector("#clearEntryButton");
const changeSetupButton = document.querySelector("#changeSetupButton");
const downloadButton = document.querySelector("#downloadButton");
const openCameraButton = document.querySelector("#openCameraButton");
const closeCameraButton = document.querySelector("#closeCameraButton");
const capturePhotoButton = document.querySelector("#capturePhotoButton");
const cameraModal = document.querySelector("#cameraModal");
const cameraVideo = document.querySelector("#cameraVideo");
const cameraCanvas = document.querySelector("#cameraCanvas");

let cameraStream = null;

loginForm.addEventListener("submit", handleLoginSubmit);
logoutButton.addEventListener("click", handleLogout);
adminUserForm.addEventListener("submit", handleAdminUserSubmit);
reportTypeInput.addEventListener("change", syncCategoryField);
receiptInput.addEventListener("change", renderReceiptPreview);
reportSetupForm.addEventListener("submit", handleSetupSubmit);
setupSubmitButton.addEventListener("click", handleSetupSubmit);
openProjectButton.addEventListener("click", handleOpenProject);
entryForm.addEventListener("submit", handleEntrySubmit);
clearEntryButton.addEventListener("click", resetEntryForm);
changeSetupButton.addEventListener("click", showSetup);
downloadButton.addEventListener("click", handleDownload);
openCameraButton.addEventListener("click", openCamera);
closeCameraButton.addEventListener("click", closeCamera);
capturePhotoButton.addEventListener("click", capturePhoto);

await init();

async function init() {
  syncCategoryField();
  syncSetupButtonLabel();
  renderReceiptPreview();
  renderEntries();
  hideProjectWorkspace();
  showLoginScreen();
  await restoreSession();
}

async function restoreSession() {
  if (!state.authToken) {
    return;
  }

  try {
    const payload = await api("/api/session");
    state.authUser = payload.user;
    await bootAuthenticatedApp();
  } catch {
    clearSession();
    showLoginScreen();
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;

  if (!username || !password) {
    return;
  }

  loginButton.disabled = true;
  setLoginFeedback("");

  try {
    const payload = await api("/api/login", {
      method: "POST",
      body: { username, password },
      skipAuth: true,
    });

    state.authToken = payload.token;
    state.authUser = payload.user;
    window.localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
    loginPasswordInput.value = "";
    await bootAuthenticatedApp();
  } catch (error) {
    setLoginFeedback(error?.message || "Nao foi possivel entrar.");
  } finally {
    loginButton.disabled = false;
  }
}

async function bootAuthenticatedApp() {
  clearCurrentProjectState();
  state.projects = [];
  renderProjects();
  state.storage = createRemoteStorage();
  sessionUserLabel.textContent = `Conta ativa: ${state.authUser?.displayName || state.authUser?.username || "-"}`;
  showAppScreen();
  syncAdminPanel();
  showWorkspaceList();
  await refreshProjects();
  if (state.authUser?.isAdmin) {
    await refreshAdminUsers();
  }
}

function handleLogout() {
  clearSession();
  clearCurrentProjectState();
  state.projects = [];
  renderProjects();
  renderAdminUsers([]);
  showLoginScreen();
}

function clearSession() {
  state.authToken = "";
  state.authUser = null;
  state.storage = null;
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

function setLoginFeedback(message) {
  if (!message) {
    loginFeedback.textContent = "";
    loginFeedback.classList.add("hidden");
    return;
  }

  loginFeedback.textContent = message;
  loginFeedback.classList.remove("hidden");
}

function showLoginScreen() {
  loginScreen.classList.remove("hidden");
  appContent.classList.add("hidden");
  loginUsernameInput.focus();
}

function showAppScreen() {
  loginScreen.classList.add("hidden");
  appContent.classList.remove("hidden");
}

function syncAdminPanel() {
  if (state.authUser?.isAdmin) {
    adminPanel.classList.remove("hidden");
    return;
  }

  adminPanel.classList.add("hidden");
}

function createRemoteStorage() {
  return {
    async listProjects() {
      const response = await api("/api/projects");
      return Array.isArray(response.projects) ? response.projects.filter(isValidProjectRecord) : [];
    },
    async getProject(projectId) {
      const response = await api(`/api/projects/${encodeURIComponent(projectId)}`);
      if (!isValidProjectRecord(response.project)) {
        throw new Error("Projeto remoto invalido");
      }
      return response.project;
    },
    async saveProject(project) {
      if (project.id) {
        const response = await api(`/api/projects/${encodeURIComponent(project.id)}`, {
          method: "PUT",
          body: project,
        });
        if (!isValidProjectRecord(response.project)) {
          throw new Error("Retorno invalido ao atualizar projeto");
        }
        return response.project;
      }

      const response = await api("/api/projects", {
        method: "POST",
        body: project,
      });
      if (!isValidProjectRecord(response.project)) {
        throw new Error("Retorno invalido ao criar projeto");
      }
      return response.project;
    },
    async deleteProject(projectId) {
      await api(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
    },
  };
}

async function handleSetupSubmit(event) {
  event?.preventDefault?.();

  const nextUserName = userNameInput.value.trim();
  const nextProjectName = normalizeProjectName(projectNameInput.value);
  const nextReportType = reportTypeInput.value;

  if (!nextUserName) {
    userNameInput.focus();
    return;
  }

  if (!nextProjectName) {
    projectNameInput.focus();
    return;
  }

  try {
    if (state.isEditingSetup && state.projectId) {
      const renamedEntries = state.entries.map((entry) => ({
        ...entry,
        project: nextProjectName,
        category: nextReportType,
      }));

      state.userName = nextUserName;
      state.projectName = nextProjectName;
      state.reportType = nextReportType;
      state.entries = renamedEntries;

      const project = await state.storage.saveProject({
        id: state.projectId,
        name: nextProjectName,
        userName: nextUserName,
        reportType: nextReportType,
        entries: renamedEntries,
      });

      state.projectId = project.id;
      state.isEditingSetup = false;
      await refreshProjects();
      renderCurrentProject();
      syncSetupButtonLabel();
      openProjectButton.classList.remove("hidden");
      showWorkspaceList();
      return;
    }

    const existingProject = findProjectByName(nextProjectName);
    const currentEntries = existingProject
      ? (await state.storage.getProject(existingProject.id)).entries || []
      : [];

    const project = await state.storage.saveProject({
      id: existingProject?.id || "",
      name: nextProjectName,
      userName: nextUserName,
      reportType: nextReportType,
      entries: currentEntries,
    });

    state.userName = nextUserName;
    state.projectId = project.id;
    state.projectName = project.name;
    state.reportType = project.reportType || nextReportType;
    state.entries = Array.isArray(project.entries) ? project.entries : [];
    state.isEditingSetup = false;

    await refreshProjects();
    renderProjects();
    syncSetupButtonLabel();
    userNameInput.value = project.userName || nextUserName;
    projectNameInput.value = project.name;
    reportTypeInput.value = project.reportType || nextReportType;
    syncCategoryField();
    showWorkspaceList();
  } catch (error) {
    console.error(error);
    window.alert(`Nao foi possivel salvar o projeto. ${error?.message || ""}`.trim());
  }
}

function handleOpenProject() {
  showWorkspaceList();
}

async function handleEntrySubmit(event) {
  event.preventDefault();

  if (!state.projectId) {
    window.alert("Selecione um projeto antes de adicionar itens.");
    return;
  }

  const formData = new FormData(entryForm);
  const value = Number(formData.get("entryValue") || 0);
  const receipts = await filesToReceiptData(Array.from(receiptInput.files || []));
  const entry = {
    id: buildId(),
    date: String(formData.get("entryDate") || ""),
    project: state.projectName,
    costCenter: String(formData.get("entryCostCenter") || "").trim(),
    description: String(formData.get("entryDescription") || "").trim(),
    value,
    category: state.reportType,
    receipts,
  };

  if (!entry.date || !entry.costCenter || !entry.description || value <= 0) {
    return;
  }

  state.entries.unshift(entry);

  try {
    await persistCurrentProject();
    renderEntries();
    resetEntryForm();
    await refreshProjects();
  } catch (error) {
    console.error(error);
    window.alert("Nao foi possivel salvar o item no projeto.");
  }
}

function resetEntryForm() {
  entryForm.reset();
  syncCategoryField();
  renderReceiptPreview();
}

function showSetup() {
  workspace.classList.add("hidden");
  state.isEditingSetup = true;
  syncSetupButtonLabel(true);
  openProjectButton.classList.add("hidden");
  reportSetupForm.scrollIntoView({ behavior: "smooth", block: "start" });
  userNameInput.focus();
}

function syncCategoryField() {
  entryCategoryInput.value = reportTypeInput.value;
}

async function refreshProjects() {
  state.projects = await state.storage.listProjects();
  renderProjects();
}

async function refreshAdminUsers() {
  if (!state.authUser?.isAdmin) {
    return;
  }

  const payload = await api("/api/admin/users");
  renderAdminUsers(Array.isArray(payload.users) ? payload.users : []);
}

function renderAdminUsers(users) {
  if (!users.length) {
    adminUsersList.className = "saved-projects empty";
    adminUsersList.innerHTML = "<p>Nenhum usuario cadastrado.</p>";
    return;
  }

  adminUsersList.className = "saved-projects";
  adminUsersList.innerHTML = users
    .map((user) => `
      <article class="project-chip">
        <div class="project-chip-name">
          <span>${escapeHtml(user.username)}</span>
        </div>
        <div class="project-chip-actions">
          <small class="project-chip-count">${user.isAdmin ? "admin" : "usuario"}</small>
        </div>
      </article>
    `)
    .join("");
}

async function handleAdminUserSubmit(event) {
  event.preventDefault();

  if (!state.authUser?.isAdmin) {
    return;
  }

  const username = adminNewUsernameInput.value.trim().toLowerCase();
  const password = adminNewPasswordInput.value.trim();

  if (!username || !password) {
    return;
  }

  setAdminFeedback("");

  try {
    await api("/api/admin/users", {
      method: "POST",
      body: { username, password },
    });

    adminUserForm.reset();
    setAdminFeedback("Usuario criado com sucesso.", false);
    await refreshAdminUsers();
  } catch (error) {
    setAdminFeedback(error?.message || "Nao foi possivel criar o usuario.", true);
  }
}

function setAdminFeedback(message, isError = true) {
  if (!message) {
    adminFeedback.textContent = "";
    adminFeedback.classList.add("hidden");
    adminFeedback.classList.remove("login-feedback--success");
    return;
  }

  adminFeedback.textContent = message;
  adminFeedback.classList.remove("hidden");
  adminFeedback.classList.toggle("login-feedback--success", !isError);
}

function renderProjects() {
  if (!state.projects.length) {
    projectList.className = "saved-projects empty";
    projectList.innerHTML = "<p>Nenhum projeto salvo.</p>";
    return;
  }

  projectList.className = "saved-projects";
  projectList.innerHTML = state.projects
    .map((project) => `
      <article class="project-chip">
        <button type="button" class="project-chip-name" data-open-project="${project.id}">
          <span>${escapeHtml(project.name)}</span>
        </button>
        <div class="project-chip-actions">
          <small class="project-chip-count">${project.entryCount || 0} itens</small>
          <button type="button" class="project-chip-delete" data-delete-project="${project.id}">Excluir</button>
        </div>
      </article>
    `)
    .join("");

  projectList.querySelectorAll("[data-open-project]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await loadProjectIntoForm(button.dataset.openProject || "");
      } catch (error) {
        console.error(error);
        window.alert("Nao foi possivel abrir esse projeto.");
      }
    });
  });

  projectList.querySelectorAll("[data-delete-project]").forEach((button) => {
    button.addEventListener("click", async () => {
      const projectId = button.dataset.deleteProject || "";

      try {
        await state.storage.deleteProject(projectId);

        if (state.projectId === projectId) {
          clearCurrentProjectState();
        }

        await refreshProjects();
        renderEntries();
      } catch (error) {
        console.error(error);
        window.alert("Nao foi possivel excluir o projeto.");
      }
    });
  });
}

async function loadProjectIntoForm(projectId) {
  if (!projectId) {
    return;
  }

  const project = await state.storage.getProject(projectId);

  state.projectId = project.id;
  state.projectName = project.name;
  state.userName = project.userName || "";
  state.reportType = project.reportType || "Reembolso";
  state.entries = Array.isArray(project.entries) ? project.entries : [];
  state.isEditingSetup = false;

  userNameInput.value = state.userName;
  projectNameInput.value = state.projectName;
  reportTypeInput.value = state.reportType;
  syncCategoryField();
  syncSetupButtonLabel();
  openProjectButton.classList.remove("hidden");
  renderCurrentProject();
  showProjectWorkspace();
  workspace.classList.remove("hidden");
  workspace.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderCurrentProject() {
  summaryUser.textContent = state.userName || "-";
  summaryProject.textContent = state.projectName || "-";
  summaryType.textContent = state.reportType || "-";
  renderEntries();
}

function clearCurrentProjectState() {
  state.userName = "";
  state.reportType = "Reembolso";
  state.projectName = "";
  state.projectId = "";
  state.isEditingSetup = false;
  state.entries = [];
  userNameInput.value = "";
  projectNameInput.value = "";
  reportTypeInput.value = "Reembolso";
  syncCategoryField();
  syncSetupButtonLabel();
  openProjectButton.classList.remove("hidden");
  hideProjectWorkspace();
  workspace.classList.add("hidden");
}

function syncSetupButtonLabel(forceEdit = false) {
  setupSubmitButton.textContent = (forceEdit || state.isEditingSetup) ? "Salvar alteracoes" : "Salvar projeto";
}

function showWorkspaceList() {
  workspace.classList.remove("hidden");
  hideProjectWorkspace();
  workspace.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showProjectWorkspace() {
  projectWorkspaceContent.classList.remove("hidden");
}

function hideProjectWorkspace() {
  projectWorkspaceContent.classList.add("hidden");
}

function renderReceiptPreview() {
  clearPreviewUrls();

  const files = Array.from(receiptInput.files || []);
  if (!files.length) {
    receiptPreview.className = "receipt-preview empty";
    receiptPreview.innerHTML = "<p>Nenhum comprovante selecionado.</p>";
    return;
  }

  receiptPreview.className = "receipt-preview";
  receiptPreview.innerHTML = files.map(renderReceiptPreviewItem).join("");
}

function clearPreviewUrls() {
  receiptPreview.querySelectorAll("[data-preview-url]").forEach((image) => {
    const url = image.dataset.previewUrl || "";
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  });
}

function renderReceiptPreviewItem(file) {
  const previewMarkup = file.type.startsWith("image/")
    ? buildImagePreview(file)
    : '<div class="receipt-thumb file">PDF</div>';

  return `
    <article class="receipt-item">
      ${previewMarkup}
      <div>
        <p class="receipt-name">${escapeHtml(file.name)}</p>
        <p class="receipt-meta">${formatFileSize(file.size)} | ${escapeHtml(file.type || "arquivo")}</p>
      </div>
    </article>
  `;
}

function buildImagePreview(file) {
  const previewUrl = URL.createObjectURL(file);
  return `<div class="receipt-thumb"><img src="${previewUrl}" alt="" data-preview-url="${previewUrl}"></div>`;
}

function renderEntries() {
  const total = state.entries.reduce((sum, entry) => sum + Number(entry.value || 0), 0);
  totalValue.textContent = currencyFormatter.format(total);
  downloadButton.disabled = state.entries.length === 0;

  if (!state.entries.length) {
    itemsList.className = "items-list empty";
    itemsList.innerHTML = "<p>Adicione pelo menos um item para liberar a exportacao.</p>";
    return;
  }

  itemsList.className = "items-list";
  itemsList.innerHTML = state.entries.map(renderEntryCard).join("");

  itemsList.querySelectorAll("[data-remove-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.entries = state.entries.filter((entry) => entry.id !== button.dataset.removeId);

      try {
        await persistCurrentProject();
        renderEntries();
        await refreshProjects();
      } catch (error) {
        console.error(error);
        window.alert("Nao foi possivel remover o item.");
      }
    });
  });
}

function renderEntryCard(entry) {
  const receiptCount = Array.isArray(entry.receipts) ? entry.receipts.length : 0;
  const receiptText = receiptCount === 1 ? "1 comprovante" : `${receiptCount} comprovantes`;

  return `
    <article class="item-card">
      <div class="item-topline">
        <p class="item-title">${escapeHtml(entry.project)}</p>
        <span class="item-value">${currencyFormatter.format(Number(entry.value || 0))}</span>
      </div>
      <div class="item-meta">
        <span>${formatDateDisplay(entry.date)}</span>
        <span>${escapeHtml(entry.costCenter)}</span>
      </div>
      <p class="item-extra">${escapeHtml(entry.description)}</p>
      <div class="item-footer">
        <span class="item-meta">${escapeHtml(entry.category)} | ${receiptText}</span>
        <button class="remove-button" type="button" data-remove-id="${entry.id}">Remover</button>
      </div>
    </article>
  `;
}

async function persistCurrentProject() {
  if (!state.projectId) {
    return;
  }

  const project = await state.storage.saveProject({
    id: state.projectId,
    name: state.projectName,
    userName: state.userName,
    reportType: state.reportType,
    entries: state.entries,
  });

  state.projectId = project.id;
}

async function handleDownload() {
  if (!state.entries.length) {
    return;
  }

  downloadButton.disabled = true;
  downloadButton.textContent = "Gerando planilha...";

  try {
    const workbook = await loadWorkbookTemplate();
    buildMainSheet(workbook);
    removeUnusedSheets(workbook);
    await buildReceiptsSheet(workbook);

    const buffer = await workbook.xlsx.writeBuffer();
    await triggerDownload(buffer, buildFileName());
  } catch (error) {
    console.error(error);
    window.alert("Nao foi possivel gerar a planilha.");
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = "Baixar planilha XLSX";
  }
}

function buildMainSheet(workbook) {
  if (state.reportType === "Km") {
    buildKmSheet(workbook);
    return;
  }

  const targetSheetName = state.reportType === "Reembolso" ? "Reembolso" : "Prestacao de Contas";
  let sheet = getWorksheetByCandidates(workbook, [targetSheetName, "Prestação de Contas", "PrestaÃ§Ã£o de Contas"]);

  if (!sheet) {
    sheet = workbook.addWorksheet(targetSheetName);
  }

  sheet.name = targetSheetName;
  clearSheetArea(sheet, 8, 5, 200);
  sheet.getCell("A1").value = "Nome";
  sheet.getCell("A2").value = state.userName;
  clearSheetArea(sheet, 6, 5, 1);
  sheet.getCell("A6").value = "Nome:";
  sheet.getCell("B6").value = state.userName;
  sheet.getCell("A7").value = "Data";
  sheet.getCell("B7").value = "Projeto";
  sheet.getCell("C7").value = "Centro de Custo";
  sheet.getCell("D7").value = "Descricao";
  sheet.getCell("E7").value = "Valor";

  ["A6", "B6", "A7", "B7", "C7", "D7", "E7"].forEach((cellRef) => {
    sheet.getCell(cellRef).alignment = { horizontal: "left", vertical: "middle" };
  });

  state.entries.forEach((entry, index) => {
    const rowNumber = 8 + index;
    sheet.getCell(`A${rowNumber}`).value = formatDateDisplay(entry.date);
    sheet.getCell(`B${rowNumber}`).value = entry.project;
    sheet.getCell(`C${rowNumber}`).value = entry.costCenter;
    sheet.getCell(`D${rowNumber}`).value = entry.description;
    sheet.getCell(`E${rowNumber}`).value = Number(entry.value || 0);
    sheet.getCell(`E${rowNumber}`).numFmt = '"R$" #,##0.00';
  });

  const totalRowNumber = 8 + state.entries.length + 1;
  const total = state.entries.reduce((sum, entry) => sum + Number(entry.value || 0), 0);
  sheet.getCell(`D${totalRowNumber}`).value = "Total";
  sheet.getCell(`D${totalRowNumber}`).font = { bold: true };
  sheet.getCell(`E${totalRowNumber}`).value = total;
  sheet.getCell(`E${totalRowNumber}`).numFmt = '"R$" #,##0.00';
  sheet.getCell(`E${totalRowNumber}`).font = { bold: true };
}

function buildKmSheet(workbook) {
  let sheet = getWorksheetByCandidates(workbook, ["Despesas"]);

  if (!sheet) {
    sheet = workbook.addWorksheet("Despesas");
  }

  sheet.name = "Despesas";
  clearSheetArea(sheet, 7, 2, 240);
  sheet.getCell("A1").value = "Nome";
  sheet.getCell("A2").value = state.userName;

  state.entries.forEach((entry, index) => {
    const rowNumber = 7 + (index * 18);
    sheet.getCell(`A${rowNumber}`).value = formatDateDisplay(entry.date);
    sheet.getCell(`B${rowNumber}`).value = `${entry.project} - ${entry.description}`;
  });
}

async function buildReceiptsSheet(workbook) {
  const existing = getWorksheetByCandidates(workbook, ["Comprovantes"]);
  if (existing) {
    workbook.removeWorksheet(existing.id);
  }

  const sheet = workbook.addWorksheet("Comprovantes", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Data", key: "date", width: 16 },
    { header: "Descricao", key: "description", width: 34 },
    { header: "Comprovante", key: "preview", width: 42 },
  ];

  sheet.getRow(1).font = { bold: true };

  let rowIndex = 2;
  for (const entry of state.entries) {
    if (!entry.receipts.length) {
      sheet.addRow({
        date: formatDateDisplay(entry.date),
        description: entry.description,
        preview: "Sem comprovante",
      });
      rowIndex += 1;
      continue;
    }

    for (const receipt of entry.receipts) {
      const imageExtension = detectImageExtension(receipt);
      sheet.addRow({
        date: formatDateDisplay(entry.date),
        description: entry.description,
        preview: imageExtension ? "" : receipt.name,
      });

      const row = sheet.getRow(rowIndex);
      row.height = 205;

      if (imageExtension && receipt.dataUrl) {
        const imageId = workbook.addImage({
          base64: receipt.dataUrl,
          extension: imageExtension,
        });

        sheet.addImage(imageId, {
          tl: { col: 2.04, row: rowIndex - 0.88 },
          ext: { width: 250, height: 250 },
        });
      }

      rowIndex += 1;
    }
  }
}

async function loadWorkbookTemplate() {
  const response = await fetch("/Modelos.xlsx", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Template indisponivel: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

function getWorksheetByCandidates(workbook, names) {
  return names
    .map((name) => workbook.getWorksheet(name))
    .find(Boolean) || null;
}

function clearSheetArea(sheet, startRow, columns, totalRows) {
  for (let rowNumber = startRow; rowNumber < startRow + totalRows; rowNumber += 1) {
    for (let column = 1; column <= columns; column += 1) {
      sheet.getCell(rowNumber, column).value = null;
    }
  }
}

function removeUnusedSheets(workbook) {
  const allowedSheetNames = new Set(["Comprovantes"]);
  const mainSheetName = state.reportType === "Km"
    ? "Despesas"
    : state.reportType === "Reembolso"
      ? "Reembolso"
      : "Prestacao de Contas";

  allowedSheetNames.add(mainSheetName);

  workbook.worksheets
    .filter((sheet) => !allowedSheetNames.has(sheet.name))
    .forEach((sheet) => {
      workbook.removeWorksheet(sheet.id);
    });
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    receiptInput.click();
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    cameraVideo.srcObject = cameraStream;
    cameraModal.classList.remove("hidden");
    cameraModal.setAttribute("aria-hidden", "false");
  } catch (error) {
    console.error(error);
    receiptInput.click();
  }
}

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  cameraVideo.srcObject = null;
  cameraModal.classList.add("hidden");
  cameraModal.setAttribute("aria-hidden", "true");
}

async function capturePhoto() {
  if (!cameraStream) {
    return;
  }

  const videoWidth = cameraVideo.videoWidth;
  const videoHeight = cameraVideo.videoHeight;
  if (!videoWidth || !videoHeight) {
    return;
  }

  cameraCanvas.width = videoWidth;
  cameraCanvas.height = videoHeight;
  cameraCanvas.getContext("2d").drawImage(cameraVideo, 0, 0, videoWidth, videoHeight);

  const blob = await new Promise((resolve) => {
    cameraCanvas.toBlob(resolve, "image/jpeg", 0.9);
  });

  if (!blob) {
    return;
  }

  const file = new File([blob], `comprovante-${Date.now()}.jpg`, { type: "image/jpeg" });
  appendFilesToReceiptInput([file]);
  renderReceiptPreview();
  closeCamera();
}

async function triggerDownload(buffer, fileName) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function appendFilesToReceiptInput(files) {
  const transfer = new DataTransfer();
  Array.from(receiptInput.files || []).forEach((file) => transfer.items.add(file));
  files.forEach((file) => transfer.items.add(file));
  receiptInput.files = transfer.files;
}

async function filesToReceiptData(files) {
  return Promise.all(files.map(async (file) => ({
    name: file.name,
    type: file.type || "arquivo",
    size: file.size,
    dataUrl: await fileToDataUrl(file),
  })));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function api(url, options = {}) {
  const requestInit = {
    method: options.method || "GET",
    headers: {},
  };

  if (!options.skipAuth && state.authToken) {
    requestInit.headers.Authorization = `Bearer ${state.authToken}`;
  }

  if (options.body !== undefined) {
    requestInit.headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, requestInit);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Erro ${response.status}`);
  }

  return payload;
}

function isValidProjectRecord(project) {
  return Boolean(
    project &&
    typeof project === "object" &&
    typeof project.id === "string" &&
    project.id &&
    typeof project.name === "string" &&
    project.name,
  );
}

function normalizeProjectName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function findProjectByName(projectName) {
  const normalized = slugify(projectName);
  return state.projects.find((project) => slugify(project.name) === normalized) || null;
}

function formatDateDisplay(value) {
  const [year, month, day] = String(value || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectImageExtension(receipt) {
  const type = String(receipt.type || "").toLowerCase();
  const name = String(receipt.name || "").toLowerCase();

  if (type.includes("png") || name.endsWith(".png")) {
    return "png";
  }

  if (type.includes("jpeg") || type.includes("jpg") || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return "jpeg";
  }

  if (type.includes("gif") || name.endsWith(".gif")) {
    return "gif";
  }

  return null;
}

function buildFileName() {
  const safeUser = slugify(state.userName || "usuario");
  const safeProject = slugify(state.projectName || "projeto");
  const safeType = slugify(state.reportType || "relatorio");
  return `gestao-de-gastos-${safeUser}-${safeProject}-${safeType}.xlsx`;
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function buildId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
