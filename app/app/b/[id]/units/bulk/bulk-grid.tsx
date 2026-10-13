"use client";

import { useRef, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from "react";
import { Alert, Button, Card, Field, Input, inputStyles } from "@/components/ui";
import type { FieldErrors, RawUnit, UnitField } from "@/lib/units";
import { addUnitsBulkAction } from "../actions";

type Col = "label" | "area" | "occupants" | "residentName" | "phone";
type Row = Record<Col, string>;

const COLS: { key: Col; title: string; width: string; ltr?: boolean; mode?: "numeric" | "decimal" | "tel" }[] = [
  { key: "label", title: "واحد", width: "w-24" },
  { key: "area", title: "متراژ", width: "w-24", ltr: true, mode: "decimal" },
  { key: "occupants", title: "نفرات", width: "w-20", ltr: true, mode: "numeric" },
  { key: "residentName", title: "نام ساکن", width: "w-40" },
  { key: "phone", title: "موبایل", width: "w-40", ltr: true, mode: "tel" },
];

const fa = new Intl.NumberFormat("fa-IR", { useGrouping: false });
const emptyRow = (): Row => ({ label: "", area: "", occupants: "", residentName: "", phone: "" });

export function BulkGrid({ buildingId }: { buildingId: string }) {
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, emptyRow));
  const [floors, setFloors] = useState("5");
  const [perFloor, setPerFloor] = useState("4");
  const [rowErrors, setRowErrors] = useState<Record<number, FieldErrors>>({});
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const cells = useRef(new Map<string, HTMLInputElement>());

  const filledCount = rows.filter((r) => Object.values(r).some((v) => v.trim())).length;

  function generate() {
    const f = Number(floors);
    const p = Number(perFloor);
    if (!(f >= 1 && f <= 60 && p >= 1 && p <= 20)) {
      setError("تعداد طبقه‌ها و واحدهای هر طبقه را درست وارد کنید");
      return;
    }
    const generated: Row[] = [];
    for (let floor = 1; floor <= f; floor++) {
      for (let n = 1; n <= p; n++) generated.push({ ...emptyRow(), label: fa.format(floor * 100 + n) });
    }
    // Keep rows the manager already filled; replace the blank ones.
    setRows([...rows.filter((r) => Object.values(r).some((v) => v.trim())), ...generated]);
    setRowErrors({});
    setError(undefined);
  }

  function setCell(i: number, col: Col, value: string) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [col]: value } : r)));
  }

  /** Enter moves down the same column, so one column can be typed in a single run. */
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, i: number, col: Col) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // Move focus right away: a fast typist's next keys must land in the next cell.
    const next = cells.current.get(`${i + 1}:${col}`);
    if (next) return next.focus();
    setRows((rs) => [...rs, emptyRow()]);
    requestAnimationFrame(() => cells.current.get(`${i + 1}:${col}`)?.focus());
  }

  /** Pasting a block from Excel fills the grid from this cell, right and down. */
  function onPaste(e: ClipboardEvent<HTMLInputElement>, i: number, col: Col) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n");
    const start = COLS.findIndex((c) => c.key === col);
    setRows((rs) => {
      const next = [...rs];
      lines.forEach((line, li) => {
        const at = i + li;
        while (next.length <= at) next.push(emptyRow());
        const r = { ...next[at] };
        line.split("\t").forEach((v, ci) => {
          const c = COLS[start + ci];
          if (c) r[c.key] = v.trim();
        });
        next[at] = r;
      });
      return next;
    });
  }

  function save() {
    setError(undefined);
    startTransition(async () => {
      const payload: RawUnit[] = rows.map((r) => ({ ...r }));
      const result = await addUnitsBulkAction(buildingId, payload);
      // On success the action redirects; anything returned is an error.
      setRowErrors(result?.rowErrors ?? {});
      setError(result?.error ?? (result?.rowErrors ? "چند خانه را باید اصلاح کنید (قرمز)" : undefined));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-end gap-3">
        <Field label="تعداد طبقه">
          <Input value={floors} onChange={(e) => setFloors(e.target.value)} inputMode="numeric" dir="ltr" className="w-24" />
        </Field>
        <Field label="واحد در هر طبقه">
          <Input value={perFloor} onChange={(e) => setPerFloor(e.target.value)} inputMode="numeric" dir="ltr" className="w-24" />
        </Field>
        <Button type="button" variant="secondary" onClick={generate}>
          ساخت ردیف‌ها (۱۰۱، ۱۰۲، …)
        </Button>
        <p className="w-full text-small text-ink/60">
          یا از اکسل کپی کنید و در اولین خانه بچسبانید. Enter به خانه پایینی می‌رود. نفرات خالی = ۱.
        </p>
      </Card>

      {error && <Alert>{error}</Alert>}

      <Card className="overflow-x-auto p-0">
        <table className="text-label">
          <thead className="bg-neutral">
            <tr>
              <th className="p-2 text-ink/50">#</th>
              {COLS.map((c) => (
                <th key={c.key} className="p-2 text-right">
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-ink/10">
                <td className="num p-1 text-center text-small text-ink/50">{fa.format(i + 1)}</td>
                {COLS.map((c) => {
                  const err = rowErrors[i]?.[c.key as UnitField];
                  return (
                    <td key={c.key} className="p-1">
                      <input
                        ref={(el) => {
                          if (el) cells.current.set(`${i}:${c.key}`, el);
                          else cells.current.delete(`${i}:${c.key}`);
                        }}
                        value={r[c.key]}
                        onChange={(e) => setCell(i, c.key, e.target.value)}
                        onKeyDown={(e) => onKeyDown(e, i, c.key)}
                        onPaste={(e) => onPaste(e, i, c.key)}
                        dir={c.ltr ? "ltr" : undefined}
                        inputMode={c.mode}
                        title={err}
                        aria-invalid={!!err || undefined}
                        className={`${inputStyles} ${c.width} px-2 py-1.5`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={save} disabled={pending || filledCount === 0}>
          {pending ? "در حال ثبت…" : `ثبت ${fa.format(filledCount)} واحد`}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 5 }, emptyRow)])}>
          ۵ ردیف دیگر
        </Button>
      </div>
    </div>
  );
}
