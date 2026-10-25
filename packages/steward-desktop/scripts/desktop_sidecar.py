#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""代掌 Steward · Windows 桌面侧车（desktop sidecar）。

职责：把「真实 Windows 桌面操作」收敛到一个零第三方依赖的 Python 进程里，
由 TypeScript 适配器（`packages/steward-desktop/src/index.ts`）通过
**stdin/stdout 上的 JSON Lines 协议**驱动。本文件只使用 Python 标准库 + ctypes，
不访问网络、不读写证据目录以外的路径（除调用方显式传入的截图路径）。

真实系统调用（全部经 user32/gdi32/kernel32/dwmapi）：
- 窗口枚举：EnumWindows + GetWindowTextW + GetWindowRect + ClientToScreen；
- 窗口聚焦：ShowWindow + BringWindowToTop + SetForegroundWindow（AttachThreadInput
  解除前台锁；必要时用 ALT 键模拟用户手势，绝不绕过任何安全边界）；
- 真实截图：GetDC(0) + BitBlt + GetDIBits 取屏幕像素，再用 zlib 自写 PNG 编码
  （不依赖 Pillow / System.Drawing）；
- 真实鼠标：SetCursorPos + SendInput（鼠标事件进入系统输入队列）；
- 真实键盘：SendInput + KEYEVENTF_UNICODE（支持中文等 Unicode 字符，不走剪贴板）。

协议：
    请求（每行一个 JSON）：{"id": <int|str>, "op": "<op>", "params": {...}}
    响应（每行一个 JSON）：{"id": ..., "ok": true,  "data": {...}}
                          {"id": ..., "ok": false, "error": {"kind","message","details"}}
错误 kind 与 TS 适配器的失败分类对齐：
    window-not-found / focus-lost / timeout / invalid-argument /
    capture-failed / input-failed / unknown

安全边界：
- 本侧车不做白名单判断（白名单在 TS 适配器层强制执行），但**任何输入注入前都会校验
  `focusGuardHwnd`**（调用方声明的目标窗口必须是前台窗口），避免把键鼠事件打进其他窗口；
- 凭据输入一律交人：本进程不实现任何密码框读写/绕过，只提供窗口标题扫描
  （scanCredentialPrompts）供上层「发现凭据提示即停止」。
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import json
import os
import struct
import sys
import time
import traceback
import zlib
from pathlib import Path
from typing import Any, Callable

SIDECAR_VERSION = "0.1.0"

# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------


def _log(message: str) -> None:
    """诊断日志只写 stderr（stdout 是 JSON 协议通道，绝不能污染）。"""
    try:
        sys.stderr.write(message.rstrip() + "\n")
        sys.stderr.flush()
    except Exception:  # pragma: no cover - stderr 不可用时静默
        pass


class SidecarError(Exception):
    """结构化错误：kind 供 TS 层映射为失败分类。"""

    def __init__(self, kind: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.details = details


def _hwnd_int(hwnd: Any) -> int:
    """把 ctypes 的 HWND / int / None 统一成 Python int（0 表示空句柄）。"""
    if hwnd is None:
        return 0
    if isinstance(hwnd, int):
        return hwnd
    value = getattr(hwnd, "value", None)
    return int(value or 0)


def _last_error_text() -> str:
    code = ctypes.get_last_error()
    try:
        return f"WinError {code}: {ctypes.FormatError(code)}"
    except Exception:
        return f"WinError {code}"


# ---------------------------------------------------------------------------
# DPI 感知（必须在任何截图/坐标调用之前执行）
# ---------------------------------------------------------------------------

DPI_AWARENESS = "unknown"


def _enable_dpi_awareness() -> str:
    """启用 Per-Monitor V2 DPI 感知，保证截图与鼠标坐标都是物理像素。

    说明：tkinter 等未声明 DPI 感知的旧程序在 125%/150% 缩放下会被系统位图拉伸；
    本侧车作为 DPI 感知进程拿到的是物理像素坐标，与截图/SetCursorPos 一致。
    """
    global DPI_AWARENESS
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4（Win10 1703+）
    try:
        set_context = user32.SetProcessDpiAwarenessContext
        set_context.argtypes = [wt.HANDLE]
        set_context.restype = wt.BOOL
        if set_context(wt.HANDLE(-4)):
            DPI_AWARENESS = "per-monitor-v2"
            return DPI_AWARENESS
    except Exception:
        pass
    try:
        shcore = ctypes.WinDLL("shcore", use_last_error=True)
        # PROCESS_PER_MONITOR_DPI_AWARE = 2
        if shcore.SetProcessDpiAwareness(2) == 0:
            DPI_AWARENESS = "per-monitor"
            return DPI_AWARENESS
        if shcore.SetProcessDpiAwareness(1) == 0:
            DPI_AWARENESS = "system"
            return DPI_AWARENESS
    except Exception:
        pass
    try:
        if user32.SetProcessDPIAware():
            DPI_AWARENESS = "system-legacy"
            return DPI_AWARENESS
    except Exception:
        pass
    DPI_AWARENESS = "unaware"
    return DPI_AWARENESS


# ---------------------------------------------------------------------------
# Win32 常量 / 结构体 / 函数原型
# ---------------------------------------------------------------------------

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
try:
    dwmapi = ctypes.WinDLL("dwmapi", use_last_error=True)
except OSError:  # pragma: no cover - 极老系统无 dwmapi
    dwmapi = None


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wt.LONG),
        ("top", wt.LONG),
        ("right", wt.LONG),
        ("bottom", wt.LONG),
    ]


class POINT(ctypes.Structure):
    _fields_ = [("x", wt.LONG), ("y", wt.LONG)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wt.DWORD),
        ("biWidth", wt.LONG),
        ("biHeight", wt.LONG),
        ("biPlanes", wt.WORD),
        ("biBitCount", wt.WORD),
        ("biCompression", wt.DWORD),
        ("biSizeImage", wt.DWORD),
        ("biXPelsPerMeter", wt.LONG),
        ("biYPelsPerMeter", wt.LONG),
        ("biClrUsed", wt.DWORD),
        ("biClrImportant", wt.DWORD),
    ]


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wt.UINT), ("dwTime", wt.DWORD)]


ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wt.LONG),
        ("dy", wt.LONG),
        ("mouseData", wt.DWORD),
        ("dwFlags", wt.DWORD),
        ("time", wt.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wt.WORD),
        ("wScan", wt.WORD),
        ("dwFlags", wt.DWORD),
        ("time", wt.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wt.DWORD),
        ("wParamL", wt.WORD),
        ("wParamH", wt.WORD),
    ]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wt.DWORD), ("u", _INPUTUNION)]


WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)


def _bind_prototypes() -> None:
    """显式声明函数原型，避免 64 位下句柄被截断。"""
    user32.EnumWindows.argtypes = [WNDENUMPROC, wt.LPARAM]
    user32.EnumWindows.restype = wt.BOOL
    user32.IsWindow.argtypes = [wt.HWND]
    user32.IsWindow.restype = wt.BOOL
    user32.IsWindowVisible.argtypes = [wt.HWND]
    user32.IsWindowVisible.restype = wt.BOOL
    user32.IsIconic.argtypes = [wt.HWND]
    user32.IsIconic.restype = wt.BOOL
    user32.GetWindowTextLengthW.argtypes = [wt.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.GetClassNameW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
    user32.GetClassNameW.restype = ctypes.c_int
    user32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(RECT)]
    user32.GetWindowRect.restype = wt.BOOL
    user32.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(RECT)]
    user32.GetClientRect.restype = wt.BOOL
    user32.ClientToScreen.argtypes = [wt.HWND, ctypes.POINTER(POINT)]
    user32.ClientToScreen.restype = wt.BOOL
    user32.ScreenToClient.argtypes = [wt.HWND, ctypes.POINTER(POINT)]
    user32.ScreenToClient.restype = wt.BOOL
    user32.GetForegroundWindow.argtypes = []
    user32.GetForegroundWindow.restype = wt.HWND
    user32.SetForegroundWindow.argtypes = [wt.HWND]
    user32.SetForegroundWindow.restype = wt.BOOL
    user32.BringWindowToTop.argtypes = [wt.HWND]
    user32.BringWindowToTop.restype = wt.BOOL
    user32.SetActiveWindow.argtypes = [wt.HWND]
    user32.SetActiveWindow.restype = wt.HWND
    user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wt.BOOL
    user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
    user32.GetWindowThreadProcessId.restype = wt.DWORD
    user32.AttachThreadInput.argtypes = [wt.DWORD, wt.DWORD, wt.BOOL]
    user32.AttachThreadInput.restype = wt.BOOL
    user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
    user32.SetCursorPos.restype = wt.BOOL
    user32.GetCursorPos.argtypes = [ctypes.POINTER(POINT)]
    user32.GetCursorPos.restype = wt.BOOL
    user32.WindowFromPoint.argtypes = [POINT]
    user32.WindowFromPoint.restype = wt.HWND
    user32.GetAncestor.argtypes = [wt.HWND, wt.UINT]
    user32.GetAncestor.restype = wt.HWND
    user32.GetDC.argtypes = [wt.HWND]
    user32.GetDC.restype = wt.HDC
    user32.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
    user32.ReleaseDC.restype = ctypes.c_int
    user32.SendInput.argtypes = [wt.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
    user32.SendInput.restype = wt.UINT
    user32.GetSystemMetrics.argtypes = [ctypes.c_int]
    user32.GetSystemMetrics.restype = ctypes.c_int
    user32.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
    user32.PostMessageW.restype = wt.BOOL
    user32.GetDpiForWindow.argtypes = [wt.HWND]
    user32.GetDpiForWindow.restype = wt.UINT
    user32.keybd_event.argtypes = [wt.BYTE, wt.BYTE, wt.DWORD, ULONG_PTR]
    user32.keybd_event.restype = None
    kernel32.GetCurrentThreadId.argtypes = []
    kernel32.GetCurrentThreadId.restype = wt.DWORD
    kernel32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    kernel32.OpenProcess.restype = wt.HANDLE
    kernel32.CloseHandle.argtypes = [wt.HANDLE]
    kernel32.CloseHandle.restype = wt.BOOL
    kernel32.QueryFullProcessImageNameW.argtypes = [wt.HANDLE, wt.DWORD, wt.LPWSTR, ctypes.POINTER(wt.DWORD)]
    kernel32.QueryFullProcessImageNameW.restype = wt.BOOL
    gdi32.CreateCompatibleDC.argtypes = [wt.HDC]
    gdi32.CreateCompatibleDC.restype = wt.HDC
    gdi32.CreateCompatibleBitmap.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int]
    gdi32.CreateCompatibleBitmap.restype = wt.HBITMAP
    gdi32.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
    gdi32.SelectObject.restype = wt.HGDIOBJ
    gdi32.DeleteObject.argtypes = [wt.HGDIOBJ]
    gdi32.DeleteObject.restype = wt.BOOL
    gdi32.DeleteDC.argtypes = [wt.HDC]
    gdi32.DeleteDC.restype = wt.BOOL
    gdi32.BitBlt.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.HDC, ctypes.c_int, ctypes.c_int, wt.DWORD]
    gdi32.BitBlt.restype = wt.BOOL
    gdi32.GetDIBits.argtypes = [wt.HDC, wt.HBITMAP, wt.UINT, wt.UINT, ctypes.c_void_p, ctypes.POINTER(BITMAPINFOHEADER), wt.UINT]
    gdi32.GetDIBits.restype = ctypes.c_int
    user32.GetLastInputInfo.argtypes = [ctypes.POINTER(LASTINPUTINFO)]
    user32.GetLastInputInfo.restype = wt.BOOL
    kernel32.GetTickCount.argtypes = []
    kernel32.GetTickCount.restype = wt.DWORD


_bind_prototypes()

# ---- Win32 常量 -----------------------------------------------------------

SW_SHOW = 5
SW_RESTORE = 9
GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000
DWMWA_EXTENDED_FRAME_BOUNDS = 9
DWMWA_CLOAKED = 14
SRCCOPY = 0x00CC0020
DIB_RGB_COLORS = 0
WM_CLOSE = 0x0010
GA_ROOT = 2
SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79
INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
VK_RETURN = 0x0D
VK_TAB = 0x09
VK_MENU = 0x12

VK_NAMES: dict[str, int] = {
    "TAB": 0x09,
    "ENTER": 0x0D,
    "RETURN": 0x0D,
    "ESC": 0x1B,
    "ESCAPE": 0x1B,
    "SPACE": 0x20,
    "BACKSPACE": 0x08,
    "DELETE": 0x2E,
    "DEL": 0x2E,
    "INSERT": 0x2D,
    "INS": 0x2D,
    "HOME": 0x24,
    "END": 0x23,
    "PAGEUP": 0x21,
    "PAGEDOWN": 0x22,
    "LEFT": 0x25,
    "UP": 0x26,
    "RIGHT": 0x27,
    "DOWN": 0x28,
    "CTRL": 0x11,
    "CONTROL": 0x11,
    "SHIFT": 0x10,
    "ALT": 0x12,
    "MENU": 0x12,
    "WIN": 0x5B,
    "LWIN": 0x5B,
    "CAPSLOCK": 0x14,
    "NUMLOCK": 0x90,
    "PRINTSCREEN": 0x2C,
    "PAUSE": 0x13,
}
for _i in range(1, 13):
    VK_NAMES[f"F{_i}"] = 0x6F + _i

EXTENDED_KEYS = {
    0x21,  # PAGEUP
    0x22,  # PAGEDOWN
    0x23,  # END
    0x24,  # HOME
    0x25,  # LEFT
    0x26,  # UP
    0x27,  # RIGHT
    0x28,  # DOWN
    0x2D,  # INSERT
    0x2E,  # DELETE
    0x5B,  # LWIN
}

CREDENTIAL_KEYWORDS: tuple[str, ...] = (
    "密码",
    "凭据",
    "登录信息",
    "用户账户控制",
    "安全中心",
    "验证码",
    "人脸识别",
    "指纹",
    "password",
    "credential",
    "windows security",
    "uac",
    "sign in",
)

# ---------------------------------------------------------------------------
# 窗口信息
# ---------------------------------------------------------------------------


def _rect_dict(rect: RECT) -> dict[str, int]:
    return {
        "x": int(rect.left),
        "y": int(rect.top),
        "width": int(rect.right - rect.left),
        "height": int(rect.bottom - rect.top),
    }


def _window_text(hwnd: Any) -> str:
    length = user32.GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    return buf.value


def _window_class(hwnd: Any) -> str:
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def _process_name(pid: int) -> str:
    if pid <= 0:
        return ""
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ""
    try:
        size = wt.DWORD(2048)
        buf = ctypes.create_unicode_buffer(2048)
        if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return os.path.basename(buf.value)
        return ""
    finally:
        kernel32.CloseHandle(handle)


def _window_rect(hwnd: Any) -> RECT | None:
    rect = RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return None
    return rect


def _extended_frame_bounds(hwnd: Any) -> RECT | None:
    """DWM 可见边框（去掉 Win10/11 窗口四周的不可见 resize 边框）。"""
    if dwmapi is None:
        return None
    rect = RECT()
    try:
        hresult = dwmapi.DwmGetWindowAttribute(
            wt.HWND(_hwnd_int(hwnd)),
            DWMWA_EXTENDED_FRAME_BOUNDS,
            ctypes.byref(rect),
            ctypes.sizeof(rect),
        )
        if hresult == 0 and rect.right > rect.left and rect.bottom > rect.top:
            return rect
    except Exception:
        return None
    return None


def _is_cloaked(hwnd: Any) -> bool:
    if dwmapi is None:
        return False
    try:
        cloaked = ctypes.c_int(0)
        hresult = dwmapi.DwmGetWindowAttribute(
            wt.HWND(_hwnd_int(hwnd)),
            DWMWA_CLOAKED,
            ctypes.byref(cloaked),
            ctypes.sizeof(cloaked),
        )
        return hresult == 0 and cloaked.value != 0
    except Exception:
        return False


def _window_info(hwnd: Any, title: str | None = None) -> dict[str, Any]:
    h = _hwnd_int(hwnd)
    window_handle = wt.HWND(h)
    if title is None:
        title = _window_text(window_handle)
    pid = wt.DWORD(0)
    user32.GetWindowThreadProcessId(window_handle, ctypes.byref(pid))
    rect = _window_rect(window_handle)
    ext = _extended_frame_bounds(window_handle)
    client_rect = RECT()
    has_client = bool(user32.GetClientRect(window_handle, ctypes.byref(client_rect)))
    origin = POINT(0, 0)
    has_origin = bool(user32.ClientToScreen(window_handle, ctypes.byref(origin)))
    fg = user32.GetForegroundWindow()
    try:
        dpi = int(user32.GetDpiForWindow(window_handle)) or 96
    except Exception:
        dpi = 96
    info: dict[str, Any] = {
        "hwnd": h,
        "title": title,
        "pid": int(pid.value),
        "processName": _process_name(int(pid.value)),
        "className": _window_class(window_handle),
        "rect": _rect_dict(rect) if rect is not None else {"x": 0, "y": 0, "width": 0, "height": 0},
        "extendedFrame": _rect_dict(ext) if ext is not None else None,
        "clientRect": _rect_dict(client_rect) if has_client else {"x": 0, "y": 0, "width": 0, "height": 0},
        "clientOrigin": {"x": int(origin.x) if has_origin else 0, "y": int(origin.y) if has_origin else 0},
        "minimized": bool(user32.IsIconic(window_handle)),
        "visible": bool(user32.IsWindowVisible(window_handle)),
        "foreground": _hwnd_int(fg) == h,
        "focused": _hwnd_int(fg) == h,
        "dpi": dpi,
    }
    return info


def _enum_windows(visible_only: bool = True) -> list[dict[str, Any]]:
    """枚举顶层窗口（跳过无标题、本进程、cloaked 窗口）。"""
    windows: list[dict[str, Any]] = []
    self_pid = os.getpid()

    def _callback(hwnd: Any, _lparam: Any) -> bool:
        try:
            h = _hwnd_int(hwnd)
            if h == 0:
                return True
            visible = bool(user32.IsWindowVisible(hwnd))
            if visible_only and not visible:
                return True
            title = _window_text(hwnd)
            if not title.strip():
                return True
            if _is_cloaked(hwnd):
                return True
            pid = wt.DWORD(0)
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if int(pid.value) == self_pid:
                return True
            windows.append(_window_info(hwnd, title))
        except Exception:  # 单个窗口读取失败不影响整体枚举
            pass
        return True

    user32.EnumWindows(WNDENUMPROC(_callback), 0)
    # 排序：前台优先、面积大的优先，便于稳定命中目标
    windows.sort(
        key=lambda w: (
            0 if w["foreground"] else 1,
            0 if not w["minimized"] else 1,
            -(w["rect"]["width"] * w["rect"]["height"]),
        )
    )
    return windows


def _visible_titles(limit: int = 12) -> list[str]:
    titles: list[str] = []
    for window in _enum_windows(visible_only=True):
        title = str(window["title"]).strip()
        if title and title not in titles:
            titles.append(title)
        if len(titles) >= limit:
            break
    return titles


def _title_matches(title: str, needle: str, case_sensitive: bool) -> bool:
    if case_sensitive:
        return needle in title
    return needle.lower() in title.lower()


def _find_window(params: dict[str, Any]) -> dict[str, Any]:
    """按 hwnd 或标题子串定位一个可见窗口；找不到抛 window-not-found。"""
    raw_hwnd = params.get("hwnd")
    if raw_hwnd is not None:
        h = int(raw_hwnd)
        if not h or not user32.IsWindow(wt.HWND(h)):
            raise SidecarError("window-not-found", f"窗口句柄不存在：{h}")
        return _window_info(wt.HWND(h))

    needle = str(params.get("titleContains") or params.get("title") or "").strip()
    if not needle:
        raise SidecarError("invalid-argument", "缺少标题匹配参数 titleContains")
    case_sensitive = bool(params.get("caseSensitive", False))
    visible_only = bool(params.get("visibleOnly", True))
    matches = [
        window
        for window in _enum_windows(visible_only=visible_only)
        if _title_matches(str(window["title"]), needle, case_sensitive)
    ]
    if not matches:
        raise SidecarError(
            "window-not-found",
            f"未找到标题包含「{needle}」的可见窗口。当前可见窗口：{_visible_titles()}",
            {"titles": _visible_titles(limit=20)},
        )
    matches.sort(
        key=lambda w: (
            0 if w["foreground"] else 1,
            0 if not w["minimized"] else 1,
            -(w["rect"]["width"] * w["rect"]["height"]),
        )
    )
    return matches[0]


def _require_foreground_guard(params: dict[str, Any]) -> int | None:
    """输入注入前的守护：前台窗口必须等于调用方声明的目标窗口。"""
    raw_guard = params.get("focusGuardHwnd")
    if raw_guard is None:
        return None
    guard = int(raw_guard)
    current = _hwnd_int(user32.GetForegroundWindow())
    if current != guard:
        current_title = _window_text(wt.HWND(current)) if current else ""
        raise SidecarError(
            "focus-lost",
            f"目标窗口已失去焦点：期望 hwnd={guard}，当前前台 hwnd={current}（标题「{current_title}」）",
            {"expectedHwnd": guard, "actualHwnd": current, "actualTitle": current_title},
        )
    return guard


# ---------------------------------------------------------------------------
# PNG 编码（只依赖 zlib/struct，不依赖 Pillow）
# ---------------------------------------------------------------------------


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _encode_png(width: int, height: int, rgb_rows: bytes) -> bytes:
    """把 top-down、每像素 3 字节（RGB）的像素数据编码为 PNG。"""
    stride = width * 3
    raw = bytearray((stride + 1) * height)
    for y in range(height):
        dst = y * (stride + 1)
        raw[dst] = 0  # filter type 0 (None)
        raw[dst + 1 : dst + 1 + stride] = rgb_rows[y * stride : (y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + _png_chunk(b"IEND", b"")
    )


def _capture_region(x: int, y: int, width: int, height: int) -> bytes:
    """BitBlt 抓取屏幕矩形（物理像素）并返回 PNG 字节。"""
    if width <= 0 or height <= 0:
        raise SidecarError("capture-failed", f"截图区域非法：{width}x{height} @({x},{y})")
    screen_dc = user32.GetDC(None)
    if not screen_dc:
        raise SidecarError("capture-failed", f"GetDC(0) 失败：{_last_error_text()}")
    mem_dc = gdi32.CreateCompatibleDC(screen_dc)
    if not mem_dc:
        user32.ReleaseDC(None, screen_dc)
        raise SidecarError("capture-failed", f"CreateCompatibleDC 失败：{_last_error_text()}")
    bitmap = gdi32.CreateCompatibleBitmap(screen_dc, width, height)
    if not bitmap:
        gdi32.DeleteDC(mem_dc)
        user32.ReleaseDC(None, screen_dc)
        raise SidecarError("capture-failed", f"CreateCompatibleBitmap 失败：{_last_error_text()}")
    old_object = None
    try:
        old_object = gdi32.SelectObject(mem_dc, bitmap)
        if not gdi32.BitBlt(mem_dc, 0, 0, width, height, screen_dc, x, y, SRCCOPY):
            raise SidecarError("capture-failed", f"BitBlt 失败：{_last_error_text()}")
        header = BITMAPINFOHEADER()
        header.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        header.biWidth = width
        header.biHeight = -height  # 负数 = top-down
        header.biPlanes = 1
        header.biBitCount = 32
        header.biCompression = 0  # BI_RGB
        header.biSizeImage = width * height * 4
        buffer = ctypes.create_string_buffer(width * height * 4)
        scanned = gdi32.GetDIBits(mem_dc, bitmap, 0, height, buffer, ctypes.byref(header), DIB_RGB_COLORS)
        if scanned == 0:
            raise SidecarError("capture-failed", f"GetDIBits 失败：{_last_error_text()}")
    finally:
        if old_object:
            gdi32.SelectObject(mem_dc, old_object)
        gdi32.DeleteObject(bitmap)
        gdi32.DeleteDC(mem_dc)
        user32.ReleaseDC(None, screen_dc)

    # BGRA -> RGB（用切片赋值，避免逐像素 Python 循环）
    raw = bytes(buffer)
    rgb = bytearray(width * height * 3)
    rgb[0::3] = raw[2::4]
    rgb[1::3] = raw[1::4]
    rgb[2::3] = raw[0::4]
    return _encode_png(width, height, bytes(rgb))


def _virtual_screen() -> dict[str, int]:
    return {
        "x": int(user32.GetSystemMetrics(SM_XVIRTUALSCREEN)),
        "y": int(user32.GetSystemMetrics(SM_YVIRTUALSCREEN)),
        "width": int(user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)),
        "height": int(user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)),
    }


def _intersect_rect(rect: dict[str, int], bounds: dict[str, int]) -> dict[str, int] | None:
    left = max(rect["x"], bounds["x"])
    top = max(rect["y"], bounds["y"])
    right = min(rect["x"] + rect["width"], bounds["x"] + bounds["width"])
    bottom = min(rect["y"] + rect["height"], bounds["y"] + bounds["height"])
    if right <= left or bottom <= top:
        return None
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


# ---------------------------------------------------------------------------
# 真实输入（SendInput）
# ---------------------------------------------------------------------------


def _send_inputs(events: list[INPUT]) -> int:
    if not events:
        return 0
    array = (INPUT * len(events))(*events)
    sent = user32.SendInput(len(events), array, ctypes.sizeof(INPUT))
    if sent != len(events):
        raise SidecarError(
            "input-failed",
            f"SendInput 只发送了 {sent}/{len(events)} 个事件：{_last_error_text()}",
        )
    return int(sent)


def _mouse_event(flags: int, dx: int = 0, dy: int = 0) -> INPUT:
    event = INPUT(type=INPUT_MOUSE)
    event.mi = MOUSEINPUT(dx=dx, dy=dy, mouseData=0, dwFlags=flags, time=0, dwExtraInfo=0)
    return event


def _key_event(vk: int, scan: int = 0, flags: int = 0) -> INPUT:
    event = INPUT(type=INPUT_KEYBOARD)
    event.ki = KEYBDINPUT(wVk=vk, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=0)
    return event


def _vk_for_token(token: str) -> tuple[int, bool]:
    """把按键名/单字符解析为 (虚拟键码, 是否扩展键)。"""
    upper = token.upper()
    if upper in VK_NAMES:
        vk = VK_NAMES[upper]
        return vk, vk in EXTENDED_KEYS
    if len(token) == 1:
        char = token.upper()
        if "A" <= char <= "Z" or "0" <= char <= "9":
            return ord(char), False
        if token == " ":
            return 0x20, False
    raise SidecarError(
        "invalid-argument",
        f"不支持的按键：{token}（支持 TAB/ENTER/ESC/SPACE/BACKSPACE/DELETE/HOME/END/方向键/F1-F12/单字母数字，"
        "以及 CTRL+SHIFT+ALT+WIN 组合）",
    )


def _combo_events(combo: str) -> list[INPUT]:
    tokens = [token.strip() for token in str(combo).replace(" ", "").split("+") if token.strip()]
    if not tokens:
        raise SidecarError("invalid-argument", "按键组合为空")
    modifier_tokens = tokens[:-1]
    key_token = tokens[-1]
    modifiers: list[tuple[int, bool]] = []
    for token in modifier_tokens:
        vk, extended = _vk_for_token(token)
        if vk not in (0x10, 0x11, 0x12, 0x5B):
            raise SidecarError("invalid-argument", f"组合键前缀必须是修饰键（CTRL/SHIFT/ALT/WIN）：{token}")
        modifiers.append((vk, extended))
    vk, extended = _vk_for_token(key_token)
    events: list[INPUT] = []
    for mod_vk, mod_extended in modifiers:
        events.append(_key_event(mod_vk, flags=KEYEVENTF_EXTENDEDKEY if mod_extended else 0))
    key_flags = KEYEVENTF_EXTENDEDKEY if extended else 0
    events.append(_key_event(vk, flags=key_flags))
    events.append(_key_event(vk, flags=key_flags | KEYEVENTF_KEYUP))
    for mod_vk, mod_extended in reversed(modifiers):
        events.append(
            _key_event(
                mod_vk,
                flags=(KEYEVENTF_EXTENDEDKEY if mod_extended else 0) | KEYEVENTF_KEYUP,
            )
        )
    return events


def _send_unicode_text(text: str, interval_ms: float) -> int:
    if not text:
        return 0
    data = text.encode("utf-16-le")
    units = list(struct.unpack("<%dH" % (len(data) // 2), data))
    interval = max(0.0, float(interval_ms)) / 1000.0
    sent_chars = 0
    for unit in units:
        if unit == 0x000A:  # \n -> Enter
            events = [_key_event(VK_RETURN), _key_event(VK_RETURN, flags=KEYEVENTF_KEYUP)]
        elif unit == 0x0009:  # \t -> Tab
            events = [_key_event(VK_TAB), _key_event(VK_TAB, flags=KEYEVENTF_KEYUP)]
        else:
            events = [
                _key_event(0, scan=unit, flags=KEYEVENTF_UNICODE),
                _key_event(0, scan=unit, flags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
            ]
        _send_inputs(events)
        sent_chars += 1
        if interval > 0:
            time.sleep(interval)
    return sent_chars


# ---------------------------------------------------------------------------
# 操作实现
# ---------------------------------------------------------------------------


def op_ping(params: dict[str, Any]) -> dict[str, Any]:
    foreground = user32.GetForegroundWindow()
    fg_info = None
    if _hwnd_int(foreground) != 0:
        fg_info = _window_info(foreground)
    return {
        "sidecar": "daizhang-steward-desktop",
        "version": SIDECAR_VERSION,
        "python": sys.version.split()[0],
        "pythonExecutable": sys.executable,
        "pid": os.getpid(),
        "platform": sys.platform,
        "dpiAwareness": DPI_AWARENESS,
        "screen": _virtual_screen(),
        "foreground": fg_info,
    }


def op_list_windows(params: dict[str, Any]) -> list[dict[str, Any]]:
    windows = _enum_windows(visible_only=bool(params.get("visibleOnly", True)))
    needle = str(params.get("titleContains") or "").strip()
    if needle:
        case_sensitive = bool(params.get("caseSensitive", False))
        windows = [w for w in windows if _title_matches(str(w["title"]), needle, case_sensitive)]
    return windows


def op_find_window(params: dict[str, Any]) -> dict[str, Any]:
    return _find_window(params)


def _ensure_window_shown(handle: Any) -> None:
    """把窗口恢复为「可见且未最小化」。

    Windows 的一个坑：若本进程由 STARTUPINFO(wShowWindow=SW_HIDE) 启动（例如 Node 的
    spawn({windowsHide:true})），那么**本进程的第一次 ShowWindow 调用**会被系统用
    SW_HIDE 覆盖——即调用 `ShowWindow(hwnd, SW_SHOW)` 反而可能把别人的窗口隐藏掉。
    因此这里在必要时重复调用一次，消费掉该覆盖，确保最终状态符合预期。
    """
    if user32.IsIconic(handle):
        user32.ShowWindow(handle, SW_RESTORE)
    if not user32.IsWindowVisible(handle):
        user32.ShowWindow(handle, SW_SHOW)
    # 第二次调用不再受 STARTUPINFO 覆盖，用于兜底「第一次被 SW_HIDE 覆盖」的场景
    if user32.IsIconic(handle):
        user32.ShowWindow(handle, SW_RESTORE)
    if not user32.IsWindowVisible(handle):
        user32.ShowWindow(handle, SW_SHOW)


def op_focus_window(params: dict[str, Any]) -> dict[str, Any]:
    target = _find_window(params)
    hwnd = int(target["hwnd"])
    timeout_ms = int(params.get("timeoutMs") or 3000)
    deadline = time.time() + max(0.2, timeout_ms / 1000.0)
    handle = wt.HWND(hwnd)
    _ensure_window_shown(handle)

    attempts = 0
    used_attach = False
    used_alt_trick = False
    while True:
        attempts += 1
        _ensure_window_shown(handle)
        current = _hwnd_int(user32.GetForegroundWindow())
        if current == hwnd:
            break
        if attempts == 1:
            # 经典前台锁解除：把当前前台线程的输入队列附加到本线程
            current_thread = kernel32.GetCurrentThreadId()
            foreground = user32.GetForegroundWindow()
            foreground_thread = 0
            if _hwnd_int(foreground) != 0:
                foreground_pid = wt.DWORD(0)
                foreground_thread = int(user32.GetWindowThreadProcessId(foreground, ctypes.byref(foreground_pid)))
            attached = False
            if foreground_thread and foreground_thread != int(current_thread):
                attached = bool(user32.AttachThreadInput(wt.DWORD(current_thread), wt.DWORD(foreground_thread), True))
            user32.BringWindowToTop(handle)
            user32.SetForegroundWindow(handle)
            if attached:
                user32.AttachThreadInput(wt.DWORD(current_thread), wt.DWORD(foreground_thread), False)
            used_attach = attached
        elif attempts == 3 and not used_alt_trick:
            # 仍失败：模拟 ALT 键（用户手势）解除前台锁，再聚焦
            user32.keybd_event(VK_MENU, 0, 0, 0)
            user32.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
            user32.SetForegroundWindow(handle)
            used_alt_trick = True
        else:
            user32.BringWindowToTop(handle)
            user32.SetForegroundWindow(handle)
        if time.time() >= deadline:
            current_title = _window_text(user32.GetForegroundWindow())
            raise SidecarError(
                "timeout",
                f"聚焦窗口超时（{timeout_ms}ms）：目标「{target['title']}」未成为前台窗口；"
                f"当前前台标题「{current_title}」。请确认桌面未锁定、窗口未被最小化。",
                {"target": target, "attempts": attempts, "currentTitle": current_title},
            )
        time.sleep(0.08)

    info = _window_info(handle)
    if not info["visible"] or info["minimized"]:
        raise SidecarError(
            "focus-lost",
            f"窗口无法恢复为可见状态（visible={info['visible']} minimized={info['minimized']}）：{target['title']}。"
            "请确认桌面未锁定、窗口未被其他程序强制隐藏。",
            {"window": info},
        )
    return {
        "window": info,
        "attempts": attempts,
        "usedAttachThreadInput": used_attach,
        "usedAltTrick": used_alt_trick,
        "focused": info["foreground"],
    }


def op_get_foreground(params: dict[str, Any]) -> dict[str, Any]:
    foreground = user32.GetForegroundWindow()
    if _hwnd_int(foreground) == 0:
        return {"window": None}
    return {"window": _window_info(foreground)}


def op_get_idle_info(params: dict[str, Any]) -> dict[str, Any]:
    """返回本会话的空闲毫秒数（GetLastInputInfo）。

    真实桌面是共享资源：自动化开始注入键鼠前先确认「真人最近没有输入」，可显著降低
    与真人操作互相打断的概率（本机 E2E 用）。
    """
    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(LASTINPUTINFO)
    if not user32.GetLastInputInfo(ctypes.byref(info)):
        raise SidecarError("unknown", f"GetLastInputInfo 失败：{_last_error_text()}")
    current = int(kernel32.GetTickCount())
    idle_ms = (current - int(info.dwTime)) & 0xFFFFFFFF
    if idle_ms > 0x7FFFFFFF:  # 极少数 tick 回绕场景，按 0 处理
        idle_ms = 0
    return {"idleMs": idle_ms, "lastInputTick": int(info.dwTime), "currentTick": current}


def op_window_at_point(params: dict[str, Any]) -> dict[str, Any]:
    x = int(params.get("x", 0))
    y = int(params.get("y", 0))
    point = POINT(x, y)
    window = user32.WindowFromPoint(point)
    hwnd = _hwnd_int(window)
    if hwnd == 0:
        return {"window": None, "x": x, "y": y}
    root = user32.GetAncestor(window, GA_ROOT)
    root_hwnd = _hwnd_int(root) or hwnd
    info = _window_info(wt.HWND(root_hwnd))
    info["hwndAtPoint"] = hwnd
    return {"window": info, "x": x, "y": y}


def op_screenshot(params: dict[str, Any]) -> dict[str, Any]:
    path = str(params.get("path") or "").strip()
    if not path:
        raise SidecarError("invalid-argument", "screenshot 缺少输出路径 path")
    mode = str(params.get("mode") or "window")
    bounds = _virtual_screen()
    target: dict[str, Any] | None = None

    if mode == "screen":
        rect = bounds
    elif mode == "client":
        target = _find_window(params)
        rect = {
            "x": int(target["clientOrigin"]["x"]),
            "y": int(target["clientOrigin"]["y"]),
            "width": int(target["clientRect"]["width"]),
            "height": int(target["clientRect"]["height"]),
        }
    elif mode == "window":
        target = _find_window(params)
        frame = target["extendedFrame"] or target["rect"]
        rect = {
            "x": int(frame["x"]),
            "y": int(frame["y"]),
            "width": int(frame["width"]),
            "height": int(frame["height"]),
        }
    else:
        raise SidecarError("invalid-argument", f"不支持的截图模式：{mode}（window/client/screen）")

    clamped = _intersect_rect(rect, bounds)
    if clamped is None:
        raise SidecarError(
            "capture-failed",
            f"窗口不在可见屏幕范围（可能已最小化/移出屏幕）：{rect}，屏幕 {bounds}",
            {"rect": rect, "screen": bounds},
        )
    png = _capture_region(clamped["x"], clamped["y"], clamped["width"], clamped["height"])
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(png)
    result: dict[str, Any] = {
        "path": str(output),
        "mode": mode,
        "width": clamped["width"],
        "height": clamped["height"],
        "rect": clamped,
        "requestedRect": rect,
        "screen": bounds,
        "bytes": len(png),
    }
    if target is not None:
        result["window"] = target
    return result


def op_click(params: dict[str, Any]) -> dict[str, Any]:
    x = int(params.get("x", 0))
    y = int(params.get("y", 0))
    button = str(params.get("button") or "left").lower()
    count = max(1, min(3, int(params.get("count", 1))))
    guard = _require_foreground_guard(params)
    if button == "left":
        down_flag, up_flag = MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP
    elif button == "right":
        down_flag, up_flag = MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP
    elif button == "middle":
        down_flag, up_flag = MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP
    else:
        raise SidecarError("invalid-argument", f"不支持的鼠标按键：{button}")

    point_before = POINT(0, 0)
    user32.GetCursorPos(ctypes.byref(point_before))
    window_before = op_window_at_point({"x": x, "y": y})["window"]
    if (
        guard is not None
        and params.get("requirePointInGuardWindow", False)
        and not (window_before and int(window_before["hwnd"]) == guard)
    ):
        raise SidecarError(
            "window-not-found",
            f"点击坐标 ({x},{y}) 不在目标窗口内：坐标处窗口为「{(window_before or {}).get('title', '无')}」，"
            f"目标 hwnd={guard}",
            {"windowAtPoint": window_before, "expectedHwnd": guard},
        )

    if not user32.SetCursorPos(x, y):
        raise SidecarError("input-failed", f"SetCursorPos({x},{y}) 失败：{_last_error_text()}")
    time.sleep(0.05)
    for index in range(count):
        _send_inputs([_mouse_event(down_flag)])
        time.sleep(0.02)
        _send_inputs([_mouse_event(up_flag)])
        if index < count - 1:
            time.sleep(0.05)  # 双击间隔远小于系统双击时间（默认 500ms）
    time.sleep(0.08)
    point_after = POINT(0, 0)
    user32.GetCursorPos(ctypes.byref(point_after))
    return {
        "x": x,
        "y": y,
        "button": button,
        "count": count,
        "cursorBefore": {"x": int(point_before.x), "y": int(point_before.y)},
        "cursorAfter": {"x": int(point_after.x), "y": int(point_after.y)},
        "windowAtPoint": window_before,
    }


def op_type_text(params: dict[str, Any]) -> dict[str, Any]:
    text = params.get("text")
    if not isinstance(text, str):
        raise SidecarError("invalid-argument", "typeText 缺少字符串参数 text")
    _require_foreground_guard(params)
    interval_ms = float(params.get("intervalMs", 8))
    started = time.time()
    chars = _send_unicode_text(text, interval_ms)
    return {
        "length": len(text),
        "utf16Units": chars,
        "durationMs": int((time.time() - started) * 1000),
    }


def op_press_key(params: dict[str, Any]) -> dict[str, Any]:
    combo = params.get("combo") or params.get("key")
    if not isinstance(combo, str) or not combo.strip():
        raise SidecarError("invalid-argument", "pressKey 缺少按键参数 combo（如 TAB / CTRL+S）")
    _require_foreground_guard(params)
    repeat = max(1, min(50, int(params.get("repeat", 1))))
    events = _combo_events(combo)
    for _ in range(repeat):
        _send_inputs(events)
        time.sleep(0.05)
    return {"combo": str(combo), "repeat": repeat}


def op_close_window(params: dict[str, Any]) -> dict[str, Any]:
    target = _find_window(params)
    hwnd = int(target["hwnd"])
    handle = wt.HWND(hwnd)
    timeout_ms = int(params.get("timeoutMs") or 3000)
    started = time.time()
    posted = bool(user32.PostMessageW(handle, WM_CLOSE, 0, 0))
    closed = False
    while time.time() - started < timeout_ms / 1000.0:
        if not user32.IsWindow(handle):
            closed = True
            break
        time.sleep(0.05)
    if not closed:
        closed = not bool(user32.IsWindow(handle))
    return {
        "hwnd": hwnd,
        "title": target["title"],
        "posted": posted,
        "closed": closed,
        "waitedMs": int((time.time() - started) * 1000),
    }


def op_scan_credential_prompts(params: dict[str, Any]) -> list[dict[str, Any]]:
    """扫描可见窗口标题中的凭据/安全提示关键词（发现即交人，不做任何绕过）。"""
    keywords = list(params.get("keywords") or CREDENTIAL_KEYWORDS)
    matches: list[dict[str, Any]] = []
    for window in _enum_windows(visible_only=True):
        title = str(window["title"])
        lowered = title.lower()
        for keyword in keywords:
            if keyword.lower() in lowered:
                matches.append({**window, "keyword": keyword})
                break
    return matches


OPS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "ping": op_ping,
    "listWindows": op_list_windows,
    "findWindow": op_find_window,
    "focusWindow": op_focus_window,
    "getForeground": op_get_foreground,
    "getIdleInfo": op_get_idle_info,
    "windowAtPoint": op_window_at_point,
    "screenshot": op_screenshot,
    "click": op_click,
    "typeText": op_type_text,
    "pressKey": op_press_key,
    "closeWindow": op_close_window,
    "scanCredentialPrompts": op_scan_credential_prompts,
}


# ---------------------------------------------------------------------------
# JSON Lines 主循环
# ---------------------------------------------------------------------------


def _write_response(response: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _handle_request(request: dict[str, Any]) -> dict[str, Any]:
    request_id = request.get("id")
    operation = str(request.get("op") or "")
    params = request.get("params") or {}
    if not isinstance(params, dict):
        return {
            "id": request_id,
            "ok": False,
            "error": {"kind": "invalid-argument", "message": "params 必须是 JSON 对象", "details": None},
        }
    handler = OPS.get(operation)
    if handler is None:
        return {
            "id": request_id,
            "ok": False,
            "error": {
                "kind": "invalid-argument",
                "message": f"未知操作：{operation}（可用：{', '.join(sorted(OPS))}）",
                "details": None,
            },
        }
    try:
        return {"id": request_id, "ok": True, "data": handler(params)}
    except SidecarError as error:
        return {
            "id": request_id,
            "ok": False,
            "error": {"kind": error.kind, "message": str(error), "details": error.details},
        }
    except Exception as error:  # noqa: BLE001 - 单次操作异常不能拖垮侧车
        trace = traceback.format_exc(limit=6)
        _log(trace)
        return {
            "id": request_id,
            "ok": False,
            "error": {
                "kind": "unknown",
                "message": f"{type(error).__name__}: {error}",
                "details": trace[-2000:],
            },
        }


def main() -> int:
    if sys.platform != "win32":
        _log(f"桌面侧车仅支持 Windows，当前平台：{sys.platform}")
        return 2
    for stream_name in ("stdin", "stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    _enable_dpi_awareness()
    _log(
        f"sidecar 启动：version={SIDECAR_VERSION} python={sys.version.split()[0]} "
        f"pid={os.getpid()} dpi={DPI_AWARENESS} screen={_virtual_screen()}"
    )
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id: Any = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("请求必须是 JSON 对象")
            request_id = request.get("id")
            _write_response(_handle_request(request))
        except Exception as error:  # noqa: BLE001 - 协议解析失败也要回一条可诊断响应
            _log(f"请求解析失败：{error!r}；原始行前 200 字符：{line[:200]!r}")
            _write_response(
                {
                    "id": request_id,
                    "ok": False,
                    "error": {
                        "kind": "invalid-argument",
                        "message": f"请求解析失败：{error}",
                        "details": line[:500],
                    },
                }
            )
    _log("stdin 已关闭，侧车退出")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
