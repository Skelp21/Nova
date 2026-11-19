import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useUi } from "../store/ui";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "error" ? <AlertCircle size={16} /> : t.kind === "success" ? <CheckCircle2 size={16} /> : <Info size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
