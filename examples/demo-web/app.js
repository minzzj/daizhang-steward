// 代掌 Steward · demo-web 页面脚本
// 原生浏览器 JS，零第三方依赖，不访问外网。
//
// ⚠️ 本文件包含一个【故意保留的缺陷】：登录请求超时/失败后不显示任何错误提示。
//    该缺陷用于 M1 编码回路演示与验证，不得带入产品代码。
//    复现步骤、期望/实际与验收方式见同目录 README.zh-CN.md「预置缺陷」一节。

"use strict";

// 页面侧登录超时：3 秒后主动中止请求（服务端慢网模式 4 秒才返回 504）
const LOGIN_TIMEOUT_MS = 3000;

const byId = (id) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`页面缺少元素 #${id}，index.html 可能不完整`);
  return element;
};

const els = {
  loginView: byId("login-view"),
  loginForm: byId("login-form"),
  account: byId("account"),
  password: byId("password"),
  slowMode: byId("slow-mode"),
  submit: byId("submit"),
  loginError: byId("login-error"),
  loginStatus: byId("login-status"),
  projectView: byId("project-view"),
  projectForm: byId("project-form"),
  projectName: byId("project-name"),
  projectNote: byId("project-note"),
  create: byId("create"),
  projectError: byId("project-error"),
  projectResult: byId("project-result"),
  welcome: byId("welcome"),
  backToLogin: byId("back-to-login"),
};

// 防重复提交（登录请求在超时缺陷下只会停在 pending，必须刷新页面才能重试）
let loginPending = false;
let createPending = false;

// 支持通过页面 URL 直接进入慢网模式：/login?timeout=1
if (new URLSearchParams(window.location.search).get("timeout") === "1") {
  els.slowMode.checked = true;
}

function showLoginError(message) {
  els.loginError.textContent = message;
  els.loginError.hidden = false;
}

function clearLoginError() {
  els.loginError.textContent = "";
  els.loginError.hidden = true;
}

function setLoginLoading(loading) {
  els.submit.disabled = loading;
  els.submit.textContent = loading ? "登录中…" : "登录";
  els.submit.classList.toggle("is-loading", loading);
  els.loginStatus.textContent = loading ? "正在登录，请稍候…" : "";
}

function showProjectError(message) {
  els.projectError.textContent = message;
  els.projectError.hidden = false;
}

function clearProjectMessages() {
  els.projectError.textContent = "";
  els.projectError.hidden = true;
  els.projectResult.textContent = "";
}

function setCreateLoading(loading) {
  els.create.disabled = loading;
  els.create.textContent = loading ? "提交中…" : "创建项目";
  els.create.classList.toggle("is-loading", loading);
}

function enterProjectView(account) {
  loginPending = false;
  setLoginLoading(false);
  clearLoginError();
  els.password.value = "";
  els.loginView.hidden = true;
  els.projectView.hidden = false;
  els.welcome.textContent = `当前账号：${account}`;
  clearProjectMessages();
  els.projectName.focus();
}

function backToLogin() {
  createPending = false;
  setCreateLoading(false);
  clearProjectMessages();
  els.projectView.hidden = true;
  els.loginView.hidden = false;
  els.account.focus();
}

// ---- 登录：提交 → loading → 成功进入项目表单 ---------------------------------
els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loginPending) return;

  clearLoginError();
  const account = els.account.value.trim();
  const password = els.password.value;
  if (!account || !password) {
    showLoginError("请输入账号和密码");
    els.password.focus();
    return;
  }

  loginPending = true;
  setLoginLoading(true);

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/login${els.slowMode.checked ? "?timeout=1" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, password }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);

    if (response.ok && data && data.ok) {
      enterProjectView(data.account || account);
      return;
    }

    // 非超时类失败（如 400）会正常提示；超时路径见下面的 catch
    loginPending = false;
    setLoginLoading(false);
    showLoginError((data && data.message) || `登录失败（HTTP ${response.status}）`);
  } catch (error) {
    // ⚠️⚠️ 预置缺陷（故意保留，供 M1 编码回路修复）⚠️⚠️
    //
    // 登录请求超时（AbortError）或网络异常时，这里【不显示错误提示】、
    // 【不恢复按钮状态】，导致 #submit 永远停在「登录中…」且保持禁用，
    // #login-error 始终保持 hidden —— 用户看不到任何反馈。
    //
    // 期望的正确行为（修复目标）：
    //   setLoginLoading(false);
    //   showLoginError("请求超时，请重试");
    //
    // 注意：修复时不要删除这段注释的警示作用说明，并保持选择器不变，
    // 以免破坏 tests/e2e-browser 中基于 #submit / #login-error 的断言。
    console.warn("[demo-web][已知缺陷] 登录请求失败/超时，但页面未显示任何错误提示：", error);
  } finally {
    window.clearTimeout(timer);
  }
});

// ---- 提交项目 ----------------------------------------------------------------
els.projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (createPending) return;

  clearProjectMessages();
  const name = els.projectName.value.trim();
  const note = els.projectNote.value.trim();
  if (!name) {
    showProjectError("项目名称不能为空");
    els.projectName.focus();
    return;
  }

  createPending = true;
  setCreateLoading(true);
  try {
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, note }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.ok) {
      throw new Error((data && data.message) || `提交失败（HTTP ${response.status}）`);
    }
    els.projectResult.textContent = `已提交：${data.project.name}`;
  } catch (error) {
    showProjectError(error instanceof Error ? error.message : "提交失败，请重试");
  } finally {
    createPending = false;
    setCreateLoading(false);
  }
});

els.backToLogin.addEventListener("click", backToLogin);
