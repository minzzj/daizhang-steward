#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""代掌 Steward · demo-desktop 演示程序。

真实桌面窗口（Python 标准库 tkinter），用于 A3 / tests/e2e-desktop 的真实键鼠验收：

- 窗口标题固定为「代掌演示表单」；
- 字段：客户名称、项目名称、备注；
- 按钮：保存、校验、清空；
- 状态标签显示「已保存：… / 校验失败：… / 校验通过 / 保存失败：…」；
- 保存时把 customer / project / note / saved_at 写入 JSON（目录自动创建）。

仅使用 Python 标准库：argparse、json、tkinter、datetime、pathlib。
本文件是演示素材，不含任何业务密钥、不访问网络、不写演示数据以外的内容。
"""

from __future__ import annotations

import argparse
import json
import tkinter as tk
from datetime import datetime
from pathlib import Path

APP_TITLE = "代掌演示表单"
DEFAULT_OUT = Path(__file__).resolve().parent / "out" / "project.json"
STATUS_READY = "就绪：请填写客户名称与项目名称，点击「保存」或按 Enter。"
STATUS_VALID = "校验通过：可以保存。"
STATUS_CLEARED = "已清空，请重新填写。"


def validate_form(customer: str, project: str) -> str | None:
    """校验必填字段；返回中文错误提示，返回 None 表示校验通过。"""
    if not customer.strip():
        return "校验失败：客户名称为空"
    if not project.strip():
        return "校验失败：项目名称为空"
    return None


def build_record(customer: str, project: str, note: str) -> dict[str, str]:
    """构造要落盘的记录；saved_at 为带本地时区偏移的 ISO 8601 时间。"""
    return {
        "customer": customer.strip(),
        "project": project.strip(),
        "note": note.strip(),
        "saved_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }


def save_record(out_path: Path, record: dict[str, str]) -> Path:
    """把记录写为 UTF-8 JSON（自动创建父目录），返回实际写入路径。"""
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


class StewardDemoApp:
    """「代掌演示表单」窗口。"""

    def __init__(self, root: tk.Tk, out_path: Path) -> None:
        self.root = root
        self.out_path = Path(out_path)
        self.status_var = tk.StringVar(value=STATUS_READY)
        self._build_ui()
        self._bind_keys()
        self.root.after(120, self._focus_first_field)

    # ---- 界面 ---------------------------------------------------------------
    def _build_ui(self) -> None:
        root = self.root
        root.title(APP_TITLE)
        root.geometry("640x470")
        root.minsize(560, 430)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(1, weight=1)

        header = tk.Frame(root, padx=16, pady=16)
        header.grid(row=0, column=0, sticky="ew")
        tk.Label(header, text=APP_TITLE, font=("Microsoft YaHei UI", 16, "bold"), anchor="w").pack(fill="x")
        tk.Label(
            header,
            text="本地演示素材：填写字段后点击「保存」写入 JSON（仅标准库，无网络）。",
            font=("Microsoft YaHei UI", 9),
            fg="#64748b",
            anchor="w",
        ).pack(fill="x", pady=(4, 0))

        form = tk.Frame(root, padx=16, pady=4)
        form.grid(row=1, column=0, sticky="nsew")
        form.columnconfigure(1, weight=1)
        form.rowconfigure(2, weight=1)

        label_font = ("Microsoft YaHei UI", 10)
        tk.Label(form, text="客户名称", font=label_font, anchor="w").grid(
            row=0, column=0, sticky="w", padx=(0, 12), pady=8
        )
        self.customer_entry = tk.Entry(form, font=label_font, takefocus=True)
        self.customer_entry.grid(row=0, column=1, sticky="ew", pady=8)

        tk.Label(form, text="项目名称", font=label_font, anchor="w").grid(
            row=1, column=0, sticky="w", padx=(0, 12), pady=8
        )
        self.project_entry = tk.Entry(form, font=label_font, takefocus=True)
        self.project_entry.grid(row=1, column=1, sticky="ew", pady=8)

        tk.Label(form, text="备注", font=label_font, anchor="nw").grid(
            row=2, column=0, sticky="nw", padx=(0, 12), pady=8
        )
        self.note_text = tk.Text(
            form,
            font=label_font,
            height=6,
            wrap="word",
            undo=True,
            takefocus=True,
            relief="solid",
            borderwidth=1,
        )
        self.note_text.grid(row=2, column=1, sticky="nsew", pady=8)

        buttons = tk.Frame(root, padx=16, pady=6)
        buttons.grid(row=2, column=0, sticky="ew")
        button_font = ("Microsoft YaHei UI", 10)
        self.save_button = tk.Button(buttons, text="保存", width=10, font=button_font, command=self.on_save, takefocus=True)
        self.save_button.pack(side="left", padx=(0, 8))
        self.validate_button = tk.Button(
            buttons, text="校验", width=10, font=button_font, command=self.on_validate, takefocus=True
        )
        self.validate_button.pack(side="left", padx=(0, 8))
        self.clear_button = tk.Button(buttons, text="清空", width=10, font=button_font, command=self.on_clear, takefocus=True)
        self.clear_button.pack(side="left")

        status = tk.Frame(root, padx=16, pady=12)
        status.grid(row=3, column=0, sticky="ew")
        self.status_label = tk.Label(
            status,
            textvariable=self.status_var,
            font=("Microsoft YaHei UI", 10, "bold"),
            fg="#1d4ed8",
            anchor="w",
            justify="left",
            wraplength=580,
        )
        self.status_label.pack(fill="x")
        tk.Label(
            status,
            text="键盘提示：Tab / Shift+Tab 切换控件；客户名称、项目名称内按 Enter 保存；备注内 Ctrl+Enter 保存。",
            font=("Microsoft YaHei UI", 9),
            fg="#64748b",
            anchor="w",
        ).pack(fill="x", pady=(6, 0))

    def _bind_keys(self) -> None:
        # 客户名称 / 项目名称内按 Enter 触发保存
        for entry in (self.customer_entry, self.project_entry):
            entry.bind("<Return>", self._on_entry_return)
            entry.bind("<KP_Enter>", self._on_entry_return)
        # 备注是多行文本：Enter 保留换行，Ctrl+Enter 保存；Tab 用于移出焦点
        self.note_text.bind("<Control-Return>", self._on_note_save)
        self.note_text.bind("<Control-KP_Enter>", self._on_note_save)
        self.note_text.bind("<Tab>", self._on_note_tab)
        self.note_text.bind("<Shift-Tab>", self._on_note_shift_tab)

    def _focus_first_field(self) -> None:
        self.root.lift()
        self.customer_entry.focus_set()

    # ---- 键盘事件 -----------------------------------------------------------
    def _on_entry_return(self, _event: tk.Event) -> str:
        self.on_save()
        return "break"

    def _on_note_save(self, _event: tk.Event) -> str:
        self.on_save()
        return "break"

    def _on_note_tab(self, _event: tk.Event) -> str:
        self.save_button.focus_set()
        return "break"

    def _on_note_shift_tab(self, _event: tk.Event) -> str:
        self.project_entry.focus_set()
        return "break"

    # ---- 动作 ---------------------------------------------------------------
    def _note_value(self) -> str:
        return self.note_text.get("1.0", "end-1c")

    def _focus_for_error(self, error: str) -> None:
        """按错误类型把焦点移到对应必填字段，方便键盘用户直接修正。"""
        if "客户名称" in error:
            self.customer_entry.focus_set()
        else:
            self.project_entry.focus_set()

    def on_save(self) -> None:
        """保存：先校验必填项，校验失败不写文件；成功则写 JSON 并更新状态标签。"""
        customer = self.customer_entry.get()
        project = self.project_entry.get()
        note = self._note_value()

        error = validate_form(customer, project)
        if error:
            self.status_var.set(error)
            self._focus_for_error(error)
            return

        record = build_record(customer, project, note)
        try:
            saved_path = save_record(self.out_path, record)
        except OSError as exc:
            self.status_var.set(f"保存失败：{exc}")
            return
        self.status_var.set(f"已保存：{saved_path}")

    def on_validate(self) -> None:
        """校验：只检查必填项，不写文件。"""
        error = validate_form(self.customer_entry.get(), self.project_entry.get())
        if error:
            self.status_var.set(error)
            self._focus_for_error(error)
            return
        self.status_var.set(STATUS_VALID)

    def on_clear(self) -> None:
        """清空：清空三个字段与状态，焦点回到客户名称。"""
        self.customer_entry.delete(0, "end")
        self.project_entry.delete(0, "end")
        self.note_text.delete("1.0", "end")
        self.status_var.set(STATUS_CLEARED)
        self.customer_entry.focus_set()


def run_self_test(work_path: Path) -> int:
    """无 GUI 自检：校验规则、字段裁剪、JSON 落盘与字段完整性；返回退出码。"""
    failures: list[str] = []

    cases = [
        ("客户名称为空", "", "项目A", "校验失败：客户名称为空"),
        ("项目名称为空", "客户A", "   ", "校验失败：项目名称为空"),
        ("两项都为空", "", "", "校验失败：客户名称为空"),
        ("两项都填写", "客户A", "项目A", None),
    ]
    for name, customer, project, expected in cases:
        actual = validate_form(customer, project)
        ok = actual == expected
        print(f"[self-test] {'OK' if ok else 'FAIL'} 校验 {name}：期望 {expected!r}，实际 {actual!r}")
        if not ok:
            failures.append(f"校验-{name}")

    record = build_record(" 客户A ", " 项目A ", "第一行\n第二行")
    if record["customer"] != "客户A" or record["project"] != "项目A" or record["note"] != "第一行\n第二行":
        failures.append("字段首尾空白裁剪")
        print(f"[self-test] FAIL 字段裁剪：{record!r}")
    else:
        print("[self-test] OK 字段首尾空白裁剪")

    if "T" not in record["saved_at"] or "+" not in record["saved_at"][10:]:
        failures.append("saved_at 格式")
        print(f"[self-test] FAIL saved_at 应为带时区偏移的 ISO 8601：{record['saved_at']!r}")
    else:
        print(f"[self-test] OK saved_at 格式：{record['saved_at']}")

    saved_path: Path | None = None
    try:
        saved_path = save_record(work_path, record)
        loaded = json.loads(saved_path.read_text(encoding="utf-8"))
        missing = [key for key in ("customer", "project", "note", "saved_at") if key not in loaded]
        if missing:
            failures.append(f"JSON 缺少字段 {missing}")
            print(f"[self-test] FAIL JSON 缺少字段：{missing}")
        elif loaded != record:
            failures.append("JSON 内容不一致")
            print(f"[self-test] FAIL JSON 内容不一致：{loaded!r}")
        else:
            print(f"[self-test] OK JSON 落盘：{saved_path}")
            print(f"[self-test] OK JSON 内容：{json.dumps(loaded, ensure_ascii=False)}")
    except OSError as exc:
        failures.append("JSON 落盘失败")
        print(f"[self-test] FAIL JSON 落盘失败：{exc}")
    finally:
        # 自检产物不留在仓库里：只删除本次写出的文件
        if saved_path is not None and saved_path.exists():
            try:
                saved_path.unlink()
                print(f"[self-test] OK 已清理自检产物：{saved_path}")
            except OSError as exc:
                print(f"[self-test] WARN 清理自检产物失败：{exc}")

    if failures:
        print(f"[self-test] 失败 {len(failures)} 项：{', '.join(failures)}")
        return 1
    print("[self-test] 全部通过")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="代掌 Steward · demo-desktop 演示表单（Python 标准库 tkinter 真窗口）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例：\n"
            "  python main.py\n"
            "  python main.py --out out/project.json\n"
            "  python main.py --self-test\n"
        ),
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"保存 JSON 的文件路径，默认写到本文件同目录的 out/project.json",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="不打开窗口，只跑无 GUI 自检（校验规则 + JSON 落盘），供 CI/自动化使用",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.self_test:
        return run_self_test(args.out)

    try:
        root = tk.Tk()
    except tk.TclError as exc:
        print(f"无法创建窗口（需要可交互的桌面环境）：{exc}")
        return 1
    StewardDemoApp(root, args.out)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
