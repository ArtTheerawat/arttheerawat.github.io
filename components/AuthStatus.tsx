"use client";

// Slim account chip for the nav: shows a Google sign-in button when signed
// out, or the signed-in email + logout when signed in. Uses the same
// useHiddenTasks hook so it stays in sync with the pages' auth state.

import { useRouter } from "next/navigation";
import { useHiddenTasks } from "@/lib/hidden-tasks";

export default function AuthStatus() {
  const router = useRouter();
  const { user, signInWithGoogle } = useHiddenTasks();

  if (!user) {
    return (
      <button
        type="button"
        className="auth-chip login"
        onClick={signInWithGoogle}
        title="เข้าสู่ระบบเพื่อซิงก์งานที่ซ่อนข้ามอุปกรณ์"
      >
        <span className="auth-ico">👤</span>
        <span className="auth-txt">เข้าสู่ระบบ</span>
      </button>
    );
  }

  return (
    <div className="auth-chip signed">
      <span className="auth-ico">🔓</span>
      <span className="auth-txt" title={user.email || user.name || "บัญชี"}>
        {user.name || user.email || "บัญชี"}
      </span>
      <button
        type="button"
        className="auth-logout"
        title="ออกจากระบบ"
        onClick={async () => {
          const res = await fetch("/auth/sign-out", { method: "POST" });
          if (res.ok) {
            await router.refresh();
            router.push("/");
          }
        }}
      >
        ✕
      </button>
    </div>
  );
}