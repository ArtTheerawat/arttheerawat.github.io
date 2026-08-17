"use client";

// Reusable "hidden tasks" UI, shared by /today, the home next-card, and the
// course-detail modal in /schedule.
//  - HideButton: small hide button that opens a confirmation modal.
//  - HideModal / ConfirmClear: full a11y (role=dialog, aria-modal, Esc, focus).

import { useEffect, useRef, useState } from "react";
import {
  HIDE_REASONS,
  hideTask,
  taskKey,
  type Hiddenable,
  type HiddenTask,
} from "@/lib/hidden-tasks";

/** Reason label shown in the hidden list. */
export function hiddenReasonText(h: HiddenTask): string {
  const base = HIDE_REASONS.find((r) => r.id === h.reason)?.label || h.reason;
  return h.custom ? `${base} · ${h.custom}` : base;
}

interface HideModalProps {
  assignment: Hiddenable;
  onConfirm: (reason: string, custom?: string) => void;
  onClose: () => void;
}

/** Confirmation dialog that lets the user pick a reason (and free text for "other"). */
export function HideModal({ assignment, onConfirm, onClose }: HideModalProps) {
  const [reason, setReason] = useState("wrong-due");
  const [other, setOther] = useState("");
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Focus first radio on open; Esc closes; restore nothing (page stays live).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      firstInputRef.current?.focus?.();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const radioName = `hide-reason-${taskKey(assignment)}`;

  return (
    <div
      className="detail-modal open hide-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hide-task-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet">
        <div className="hh">
          <h2 id="hide-task-title">ซ่อนงานนี้?</h2>
          <button
            ref={cancelRef}
            className="close"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
          >
            ✕
          </button>
        </div>

        <div className="hide-assign">
          <div className="hide-ttl">{assignment.title || "งาน"}</div>
          <div className="hide-course">{assignment.course || ""}</div>
          {assignment.due && (
            <div className="hide-due">⏰ กำหนดส่ง {assignment.due}</div>
          )}
        </div>

        <fieldset className="hide-fieldset">
          <legend>เหตุผลที่ซ่อน</legend>
          {HIDE_REASONS.map((r, i) => (
            <label key={r.id} className="hide-radio">
              <input
                ref={i === 0 ? firstInputRef : undefined}
                type="radio"
                name={radioName}
                value={r.id}
                checked={reason === r.id}
                onChange={() => setReason(r.id)}
              />
              <span>{r.label}</span>
            </label>
          ))}
          {reason === "other" && (
            <input
              className="hide-other"
              type="text"
              placeholder="ระบุเหตุผลอื่น ๆ…"
              value={other}
              onChange={(e) => setOther(e.target.value)}
            />
          )}
        </fieldset>

        <div className="hide-actions">
          <button className="btn" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            className="btn danger"
            onClick={() => onConfirm(reason, reason === "other" ? other : undefined)}
          >
            ยืนยันซ่อน
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmClearProps {
  onConfirm: () => void;
  onClose: () => void;
}

/** Small "are you sure" dialog before clearing all hidden tasks. */
export function ConfirmClear({ onConfirm, onClose }: ConfirmClearProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.focus?.();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="detail-modal open hide-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hide-clear-title"
      tabIndex={-1}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet">
        <div className="hh">
          <h2 id="hide-clear-title">ล้างงานที่ซ่อนทั้งหมด?</h2>
          <button className="close" onClick={onClose} aria-label="ปิดหน้าต่าง">
            ✕
          </button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "10px 0 18px" }}>
          งานที่ซ่อนไว้ทั้งหมดจะกลับมาแสดงในรายการงานค้าง — ต้องการทำต่อไหม?
        </p>
        <div className="hide-actions">
          <button className="btn" onClick={onClose}>
            ยกเลิก
          </button>
          <button className="btn danger" onClick={onConfirm}>
            ล้างทั้งหมด
          </button>
        </div>
      </div>
    </div>
  );
}

interface HideButtonProps {
  assignment: Hiddenable;
  onHide: (reason: string, custom?: string) => void;
  compact?: boolean;
}

/** Small hide button (🙈 ไม่ต้องทำแล้ว) that opens the confirmation modal. */
export function HideButton({ assignment, onHide, compact }: HideButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={compact ? "hide-btn compact" : "hide-btn"}
        onClick={() => setOpen(true)}
        aria-label={`ซ่อนงาน ${assignment.title || "นี้"}`}
      >
        {compact ? "🙈" : "🙈 ไม่ต้องทำแล้ว"}
      </button>
      {open && (
        <HideModal
          assignment={assignment}
          onConfirm={(reason, custom) => {
            onHide(reason, custom);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}